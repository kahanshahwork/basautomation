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

    app.register_blueprint(parser_bp)
    app.register_blueprint(workflow_bp)
    app.register_blueprint(ocr_bp)
    app.register_blueprint(ie_bp)
    app.register_blueprint(consolidation_bp)
    app.register_blueprint(ai_bp)

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
