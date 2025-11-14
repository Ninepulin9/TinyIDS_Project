import logging
from typing import Iterable, List

from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from config import settings
from extensions import bcrypt, db, jwt, socketio
from models import User
from routes.auth import auth_bp
from routes.devices import devices_bp
from routes.logs import logs_bp
from routes.rules import rules_bp
from routes.settings import dashboard_settings_api_bp, settings_bp
from routes.users import users_bp
from routes.dashboard import dashboard_bp
from services.mqtt_service import mqtt_service
from routes.blacklist import blacklist_bp
from routes.device_rules import device_rules_bp


logging.basicConfig(level=logging.INFO)


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(settings)

    allowed_origin = app.config.get("ALLOWED_ORIGIN", "http://localhost:5173")
    cors_origins: Iterable[str] = app.config.get("CORS_ORIGINS", allowed_origin)
    if isinstance(cors_origins, str):
        cors_origins = [origin.strip() for origin in cors_origins.split(",") if origin.strip()]
    cors_origin_list: List[str] = list(cors_origins or [allowed_origin])

    cors_resources = {r"/api/*": {"origins": "http://localhost:5173"}}
    CORS(
        app,
        resources=cors_resources,
        supports_credentials=True,
        allow_headers=["Content-Type", "Authorization"],
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )

    db.init_app(app)
    bcrypt.init_app(app)
    jwt.init_app(app)
    socketio.init_app(
        app,
        cors_allowed_origins=cors_origin_list or allowed_origin,
        message_queue=app.config.get("SOCKETIO_MESSAGE_QUEUE"),
    )

    register_blueprints(app)
    register_jwt_callbacks(app)

    mqtt_service.init_app(app)

    with app.app_context():
        db.create_all()

    @app.route("/health")
    def health():
        return jsonify({"status": "ok"})

    @app.errorhandler(Exception)
    def handle_unexpected_error(error):
        if isinstance(error, HTTPException):
            return jsonify({"error": error.name, "message": error.description}), error.code

        logging.exception("Unhandled server error")
        response = jsonify({"error": "internal_server_error", "message": "An unexpected error occurred."})
        response.status_code = 500
        return response

    return app


def register_blueprints(app: Flask) -> None:
    api_prefix = "/api"

    blueprint_registry = (
        auth_bp,
        logs_bp,
        rules_bp,
        devices_bp,
        settings_bp,
        dashboard_settings_api_bp,
        users_bp,
        dashboard_bp,
        blacklist_bp,
        device_rules_bp,
    )

    for blueprint in blueprint_registry:
        bp_prefix = blueprint.url_prefix or ""
        app.register_blueprint(blueprint, url_prefix=f"{api_prefix}{bp_prefix}")


def register_jwt_callbacks(app: Flask) -> None:
    @jwt.user_lookup_loader
    def user_lookup(_jwt_header, jwt_data):
        identity = jwt_data["sub"]
        try:
            user_id = int(identity)
        except (TypeError, ValueError):
            return None
        return User.query.get(user_id)

    @jwt.expired_token_loader
    def expired_callback(jwt_header, jwt_payload):  # noqa: D401
        return jsonify({"message": "Token expired"}), 401


app = create_app()


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)
