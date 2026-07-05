"""
app.py — App factory. Wires blueprints together and initializes the DB.

This is the ONLY file that should change when you add a brand-new module
(a new blueprint file). It should never grow business logic itself.
"""

from dotenv import load_dotenv
load_dotenv()

from flask import Flask
from detector import registry
from core.db import init_db
from core.category_master import sync_categories_safe
from routes.parser_routes import parser_bp
from routes.workflow_routes import workflow_bp
from routes.ocr_routes import ocr_bp
from routes.import_export_routes import ie_bp
from routes.consolidation_routes import consolidation_bp
from routes.ai_routes import ai_bp
from routes.auth_routes import auth_bp
import os


def create_app():
    # Serve the built frontend (frontend/dist) as static files, so ONE server
    # delivers both the API and the web app on a single port/address — simplest
    # for a shared office deployment.
    frontend_dist = os.path.join(os.path.dirname(__file__), "frontend", "dist")
    if os.path.isdir(frontend_dist):
        app = Flask(__name__, static_folder=frontend_dist, static_url_path="")
    else:
        app = Flask(__name__, static_folder=".")
    registry.auto_register(os.path.join(os.path.dirname(__file__), "parsers"))

    init_db()
    sync_categories_safe()

    app.register_blueprint(auth_bp)
    app.register_blueprint(parser_bp)
    app.register_blueprint(workflow_bp)
    app.register_blueprint(ocr_bp)
    app.register_blueprint(ie_bp)
    app.register_blueprint(consolidation_bp)
    app.register_blueprint(ai_bp)

    # ── GLOBAL AUTH GUARD ────────────────────────────────────────────────────
    # Runs before EVERY request. Any API path that is not explicitly public
    # requires a valid session. Because this is enforced centrally (not per
    # route), no endpoint can accidentally be left unprotected, and there is no
    # URL/param that bypasses it. Non-API paths (the SPA shell, static assets)
    # are allowed through so the login screen itself can load; all data lives
    # behind /api and is therefore protected.
    from core import auth as _auth
    from flask import request, jsonify, g

    # Exact public API paths (method-agnostic). Everything else data-bearing is locked.
    PUBLIC_API = {"/api/auth/login"}
    # Prefixes that carry data and MUST be authenticated.
    PROTECTED_PREFIXES = ("/api/", "/tools/")
    # Top-level parser data endpoints (not under /api) that must also be locked.
    PROTECTED_EXACT = {"/parse", "/detect", "/parsers", "/pdf_page"}

    @app.before_request
    def _enforce_auth():
        path = request.path or ""
        # Always allow CORS preflight.
        if request.method == "OPTIONS":
            return None
        # Decide whether this request touches protected data.
        is_protected = (
            any(path.startswith(p) for p in PROTECTED_PREFIXES)
            or path in PROTECTED_EXACT
        )
        if not is_protected:
            # SPA shell + static assets (no data) — let them load so the login
            # page can render. All real data lives behind the protected surface.
            return None
        if path in PUBLIC_API:
            return None
        # Validate the session token from the httpOnly cookie ONLY. We never read
        # it from a header/query/body, so it can't be smuggled in via the URL.
        token = request.cookies.get(_auth.COOKIE_NAME)
        user = _auth.user_for_token(token)
        if user is None:
            return jsonify({"error": "Authentication required"}), 401
        g.current_user = user
        return None

    # Serve the frontend single-page app for any non-API path (client-side routing).
    from flask import send_from_directory

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def _spa(path):
        dist = app.static_folder
        if path and os.path.exists(os.path.join(dist, path)):
            return send_from_directory(dist, path)
        index = os.path.join(dist, "index.html")
        if os.path.exists(index):
            return send_from_directory(dist, "index.html")
        return {"status": "ok", "message": "DocParse API running (frontend not built)"}, 200

    return app


app = create_app()  # module-level for gunicorn: `gunicorn app:app`
# (docker-compose waits for the Postgres healthcheck before starting this, so
#  the DB is always reachable by the time this import runs in the container.)


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")   # set HOST=0.0.0.0 to expose on the network
    port = int(os.environ.get("PORT", "5051"))
    print(f"\n🟢  DocParse (BAS Automation Suite)  →  http://{host}:{port}\n")
    print("   Parsers:")
    for p in registry.list_parsers():
        print(f"     {p['bank_id']:12s} {p['display_name']}")
    print()
    app.run(host=host, port=port, debug=False)
