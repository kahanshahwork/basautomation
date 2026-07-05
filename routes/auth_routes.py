"""
routes/auth_routes.py — Authentication endpoints + admin user management.

Public (no session needed):
  POST /api/auth/login          {email, password}  -> sets httpOnly cookie
Authenticated (any logged-in user):
  POST /api/auth/logout
  GET  /api/auth/me
  POST /api/auth/change-password {current_password, new_password}
Admin only:
  GET    /api/admin/users
  POST   /api/admin/users               {email, name, password, role}
  PATCH  /api/admin/users/<id>          {name?, role?, is_active?}
  POST   /api/admin/users/<id>/reset-password {new_password}
  DELETE /api/admin/users/<id>

Security notes:
  • The login route is one of only two whitelisted paths in the global guard.
  • Cookies are httpOnly + SameSite=Lax so they can't be read/set by JS or the URL.
  • Admins cannot demote/deactivate/delete the last remaining admin (lockout guard).
  • Role/active flags are always read from the DB, never trusted from the client.
"""

from flask import Blueprint, request, jsonify, make_response
from core import auth
from core.db import get_db, log_audit

auth_bp = Blueprint("auth", __name__, url_prefix="/api")

# Secure cookie in production (HTTPS). Set COOKIE_SECURE=1 once you're behind TLS.
import os
_COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"


def _set_session_cookie(resp, token: str):
    resp.set_cookie(
        auth.COOKIE_NAME, token,
        httponly=True, samesite="Lax", secure=_COOKIE_SECURE,
        max_age=auth.SESSION_TTL_HOURS * 3600, path="/",
    )


def _clear_session_cookie(resp):
    resp.set_cookie(auth.COOKIE_NAME, "", httponly=True, samesite="Lax",
                    secure=_COOKIE_SECURE, max_age=0, path="/")


def _count_admins(conn) -> int:
    return conn.execute(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1"
    ).fetchone()["c"]


# ── Auth ─────────────────────────────────────────────────────────────────────
@auth_bp.route("/auth/login", methods=["POST"])
def login():
    b = request.json or {}
    email = (b.get("email") or "").strip().lower()
    password = b.get("password") or ""
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    user = auth.get_user_by_email(email)
    # Constant-ish response: same message whether the email exists or not.
    if not user or not user["is_active"] or not auth.verify_password(password, user["password_hash"]):
        return jsonify({"error": "Invalid email or password"}), 401

    token = auth.create_session(user["id"])
    auth.touch_last_login(user["id"])
    resp = make_response(jsonify({
        "user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]}
    }))
    _set_session_cookie(resp, token)
    return resp


@auth_bp.route("/auth/logout", methods=["POST"])
def logout():
    token = request.cookies.get(auth.COOKIE_NAME)
    auth.destroy_session(token)
    resp = make_response(jsonify({"ok": True}))
    _clear_session_cookie(resp)
    return resp


@auth_bp.route("/auth/me", methods=["GET"])
def me():
    u = auth.current_user()
    if u is None:
        return jsonify({"error": "Authentication required"}), 401
    return jsonify({"user": {"id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"]}})


@auth_bp.route("/auth/change-password", methods=["POST"])
def change_password():
    u = auth.current_user()
    if u is None:
        return jsonify({"error": "Authentication required"}), 401
    b = request.json or {}
    current = b.get("current_password") or ""
    new = b.get("new_password") or ""
    if len(new) < 6:
        return jsonify({"error": "New password must be at least 6 characters"}), 400
    conn = get_db()
    row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (u["id"],)).fetchone()
    if not row or not auth.verify_password(current, row["password_hash"]):
        return jsonify({"error": "Current password is incorrect"}), 400
    auth.set_password(u["id"], new)
    return jsonify({"ok": True, "message": "Password changed — please log in again"})


# ── Admin: user management ───────────────────────────────────────────────────
@auth_bp.route("/admin/users", methods=["GET"])
@auth.admin_required
def list_users():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, email, name, role, is_active, created_at, last_login FROM users ORDER BY created_at"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@auth_bp.route("/admin/users", methods=["POST"])
@auth.admin_required
def add_user():
    b = request.json or {}
    email = (b.get("email") or "").strip().lower()
    name = (b.get("name") or "").strip()
    password = b.get("password") or ""
    role = b.get("role") or "user"
    if not email or "@" not in email:
        return jsonify({"error": "A valid email is required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    if auth.get_user_by_email(email):
        return jsonify({"error": "A user with that email already exists"}), 400
    uid = auth.create_user(email, name, password, role)
    log_audit("user", uid, "create", detail=f"role={role}", actor=str(auth.current_user()["email"]))
    return jsonify({"id": uid, "email": email, "name": name, "role": role, "is_active": 1})


@auth_bp.route("/admin/users/<int:uid>", methods=["PATCH"])
@auth.admin_required
def update_user(uid):
    b = request.json or {}
    conn = get_db()
    target = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if not target:
        return jsonify({"error": "User not found"}), 404

    # Lockout guard: don't allow removing the last active admin via role/active change.
    demoting = ("role" in b and b["role"] != "admin" and target["role"] == "admin")
    deactivating = ("is_active" in b and not b["is_active"] and target["is_active"] and target["role"] == "admin")
    if (demoting or deactivating) and _count_admins(conn) <= 1:
        return jsonify({"error": "Cannot remove the last remaining administrator"}), 400

    if "name" in b:
        conn.execute("UPDATE users SET name = ? WHERE id = ?", (b["name"], uid)); conn.commit()
    if "role" in b:
        auth.set_role(uid, b["role"])
    if "is_active" in b:
        auth.set_active(uid, bool(b["is_active"]))

    row = conn.execute(
        "SELECT id, email, name, role, is_active, created_at, last_login FROM users WHERE id = ?", (uid,)
    ).fetchone()
    log_audit("user", uid, "edit", detail=str(b), actor=str(auth.current_user()["email"]))
    return jsonify(dict(row))


@auth_bp.route("/admin/users/<int:uid>/reset-password", methods=["POST"])
@auth.admin_required
def reset_password(uid):
    b = request.json or {}
    new = b.get("new_password") or ""
    if len(new) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    conn = get_db()
    if not conn.execute("SELECT id FROM users WHERE id = ?", (uid,)).fetchone():
        return jsonify({"error": "User not found"}), 404
    auth.set_password(uid, new)  # also invalidates that user's existing sessions
    log_audit("user", uid, "reset_password", actor=str(auth.current_user()["email"]))
    return jsonify({"ok": True, "message": "Password reset — the user must log in again"})


@auth_bp.route("/admin/users/<int:uid>", methods=["DELETE"])
@auth.admin_required
def delete_user(uid):
    conn = get_db()
    target = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if not target:
        return jsonify({"error": "User not found"}), 404
    if uid == auth.current_user()["id"]:
        return jsonify({"error": "You cannot delete your own account"}), 400
    if target["role"] == "admin" and _count_admins(conn) <= 1:
        return jsonify({"error": "Cannot delete the last remaining administrator"}), 400
    conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
    conn.execute("DELETE FROM users WHERE id = ?", (uid,))
    conn.commit()
    log_audit("user", uid, "delete", actor=str(auth.current_user()["email"]))
    return jsonify({"deleted": uid})
