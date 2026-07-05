"""
core/auth.py — Authentication & authorization core.

Design goals (explicitly hardened against the bypass classes you asked about):
  • Server-side sessions stored in Postgres, keyed by a random 256-bit token.
    The token lives in an httpOnly, SameSite=Lax cookie — it is never readable
    or settable by page JavaScript, and cannot be injected via the URL.
  • Every session has a hard expiry; expired tokens are rejected and cleaned up.
  • Passwords are stored ONLY as salted PBKDF2-SHA256 hashes (werkzeug).
  • Authorization is checked from the DB user's CURRENT role on every request,
    never from anything the client sends — so a user cannot self-elevate by
    tampering with a cookie, header, body, or query string.
  • The actual "require login on every /api route" gate is installed globally in
    app.py (before_request), so no individual route can forget to be protected.
    The decorators here are a second layer for admin-only endpoints.
"""

import os
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash

from core.db import get_db

COOKIE_NAME = "docparse_session"
SESSION_TTL_HOURS = int(os.environ.get("SESSION_TTL_HOURS", "12"))


# ── Password helpers ─────────────────────────────────────────────────────────
def hash_password(pw: str) -> str:
    return generate_password_hash(pw)


def verify_password(pw: str, pw_hash: str) -> bool:
    try:
        return check_password_hash(pw_hash, pw)
    except Exception:
        return False


# ── Session lifecycle ────────────────────────────────────────────────────────
def create_session(user_id: int) -> str:
    """Issue a new opaque session token for a user and persist it."""
    conn = get_db()
    token = secrets.token_urlsafe(32)  # 256 bits of entropy
    expires = datetime.now(timezone.utc) + timedelta(hours=SESSION_TTL_HOURS)
    conn.execute(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)",
        (token, user_id, expires),
    )
    conn.commit()
    return token


def destroy_session(token: str):
    if not token:
        return
    conn = get_db()
    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()


def _cleanup_expired(conn):
    conn.execute("DELETE FROM sessions WHERE expires_at < now()")
    conn.commit()


def user_for_token(token: str):
    """Return the ACTIVE user row for a valid, unexpired session token, else None.
    Reads the user's role fresh from the DB every call (no trust in the client)."""
    if not token:
        return None
    conn = get_db()
    row = conn.execute(
        """
        SELECT u.id, u.email, u.name, u.role, u.is_active, s.expires_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > now()
        """,
        (token,),
    ).fetchone()
    if not row:
        return None
    if not row["is_active"]:
        # Deactivated users are locked out immediately, even with a live token.
        return None
    return row


def current_user():
    """The user attached to this request by the global before_request guard."""
    return getattr(g, "current_user", None)


# ── User CRUD (used by the admin panel) ──────────────────────────────────────
def get_user_by_email(email: str):
    conn = get_db()
    return conn.execute(
        "SELECT * FROM users WHERE email = ?", ((email or "").strip().lower(),)
    ).fetchone()


def create_user(email: str, name: str, password: str, role: str = "user"):
    conn = get_db()
    role = role if role in ("admin", "user") else "user"
    cur = conn.execute(
        "INSERT INTO users (email, name, password_hash, role, is_active) VALUES (?,?,?,?,1)",
        ((email or "").strip().lower(), name, hash_password(password), role),
    )
    conn.commit()
    return cur.lastrowid


def set_password(user_id: int, new_password: str):
    conn = get_db()
    conn.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (hash_password(new_password), user_id),
    )
    # Force re-login everywhere for this user after a password reset.
    conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    conn.commit()


def set_role(user_id: int, role: str):
    role = role if role in ("admin", "user") else "user"
    conn = get_db()
    conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
    conn.commit()


def set_active(user_id: int, is_active: bool):
    conn = get_db()
    conn.execute(
        "UPDATE users SET is_active = ? WHERE id = ?", (1 if is_active else 0, user_id)
    )
    if not is_active:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    conn.commit()


def touch_last_login(user_id: int):
    conn = get_db()
    conn.execute("UPDATE users SET last_login = now() WHERE id = ?", (user_id,))
    conn.commit()


# ── Decorators (second layer, on top of the global guard) ────────────────────
def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            return jsonify({"error": "Authentication required"}), 401
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        u = current_user()
        if u is None:
            return jsonify({"error": "Authentication required"}), 401
        if u["role"] != "admin":
            return jsonify({"error": "Administrator access required"}), 403
        return fn(*args, **kwargs)
    return wrapper
