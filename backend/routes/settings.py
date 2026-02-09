from http import HTTPStatus
from flask import Blueprint, jsonify, request
from flask_jwt_extended import current_user, get_jwt_identity, jwt_required

from extensions import db
from models import (
    DashboardSettings,
    SystemSettings,
    DEFAULT_DASHBOARD_WIDGETS,
    TIMEFRAME_TO_MINUTES,
    MINUTES_TO_TIMEFRAME,
)


settings_bp = Blueprint("settings", __name__, url_prefix="/settings")
dashboard_settings_api_bp = Blueprint("dashboard_settings_api", __name__, url_prefix="/dashboard-settings")

DEFAULT_GRAPH_TIMEFRAME = "days"
ALLOWED_TIMEFRAMES = {"seconds", "minutes", "hours", "days", "months"}
DEFAULT_USER_ID = 1


def _resolve_user_id() -> int:
    identity = get_jwt_identity()
    if identity is None:
        return DEFAULT_USER_ID
    try:
        return int(identity)
    except (TypeError, ValueError):
        return DEFAULT_USER_ID


def _ensure_dashboard_settings(user_id: int) -> DashboardSettings:
    settings = DashboardSettings.query.filter_by(user_id=user_id).first()
    if not settings:
        settings = DashboardSettings(user_id=user_id)
        settings.set_graph_timeframe(DEFAULT_GRAPH_TIMEFRAME)
        settings.widgets_visible = DEFAULT_DASHBOARD_WIDGETS.copy()
        db.session.add(settings)
        db.session.commit()
    else:
        # Ensure widget keys stay in sync with defaults.
        normalized = settings.to_widget_config()
        if normalized != settings.widgets_visible:
            settings.widgets_visible = normalized
            db.session.commit()
    return settings


def _serialize_dashboard_settings(settings: DashboardSettings) -> dict:
    return {
        "graph_timeframe": MINUTES_TO_TIMEFRAME.get(settings.timeframe_minutes, DEFAULT_GRAPH_TIMEFRAME),
        "timeframe_minutes": settings.timeframe_minutes,
        "widgets": settings.to_widget_config(),
        "widgets_visible": settings.to_widget_config(),
        "updated_at": settings.updated_at.isoformat() if settings.updated_at else None,
    }


@dashboard_settings_api_bp.route("/me", methods=["OPTIONS"])
def dashboard_settings_options():
    return ("", HTTPStatus.NO_CONTENT)


@dashboard_settings_api_bp.route("/me", methods=["GET", "PUT"])
@jwt_required(optional=True)
def dashboard_settings_modern():
    user_id = _resolve_user_id()
    settings = _ensure_dashboard_settings(user_id)

    if request.method == "GET":
        return jsonify(_serialize_dashboard_settings(settings))

    payload = request.get_json(silent=True) or {}

    timeframe_minutes = payload.get("timeframe_minutes")
    if timeframe_minutes is not None:
        try:
            settings.timeframe_minutes = int(timeframe_minutes)
        except (TypeError, ValueError):
            return jsonify({"message": "timeframe_minutes must be an integer"}), HTTPStatus.BAD_REQUEST

    timeframe = payload.get("graph_timeframe")
    if timeframe is not None:
        if timeframe not in ALLOWED_TIMEFRAMES:
            return (
                jsonify({"message": "graph_timeframe must be one of seconds, minutes, hours, days, months"}),
                HTTPStatus.BAD_REQUEST,
            )
        settings.set_graph_timeframe(timeframe)

    widgets = payload.get("widgets")
    if widgets is None:
        widgets = payload.get("widgets_visible")
    if widgets is not None:
        if not isinstance(widgets, dict):
            return jsonify({"message": "widgets must be an object of boolean flags"}), HTTPStatus.BAD_REQUEST
        filtered_widgets = {
            key: bool(value) for key, value in widgets.items() if key in DEFAULT_DASHBOARD_WIDGETS
        }
        settings.update_widgets(filtered_widgets)

    db.session.commit()
    return jsonify(_serialize_dashboard_settings(settings))


@settings_bp.route("/system", methods=["GET", "PUT"])
@jwt_required()
def system_settings():
    user_id = _resolve_user_id()
    settings = SystemSettings.query.filter_by(user_id=user_id).first()
    if not settings:
        settings = SystemSettings(user_id=user_id)
        db.session.add(settings)
        db.session.commit()

    if request.method == "GET":
        return jsonify(
            {
                "log_retention_days": settings.log_retention_days,
                "attack_notifications": settings.attack_notifications,
                "cooldown_seconds": settings.cooldown_seconds,
            }
        )

    payload = request.get_json(force=True)
    for attr in ["log_retention_days", "attack_notifications", "cooldown_seconds"]:
        if attr in payload:
            setattr(settings, attr, payload[attr])
    db.session.commit()
    return jsonify({"status": "updated"})


@settings_bp.route("/dashboard", methods=["GET", "PUT"])
@jwt_required()
def dashboard_settings():
    settings = _ensure_dashboard_settings(current_user.id)

    if request.method == "GET":
        return jsonify(
            {
                "timeframe_minutes": settings.timeframe_minutes,
                "widgets_visible": settings.to_widget_config(),
            }
        )

    payload = request.get_json(force=True) or {}
    if "timeframe_minutes" in payload and isinstance(payload["timeframe_minutes"], int):
        settings.timeframe_minutes = payload["timeframe_minutes"]
    if "widgets_visible" in payload and isinstance(payload["widgets_visible"], dict):
        settings.widgets_visible = payload["widgets_visible"]
    db.session.commit()
    return jsonify({"status": "updated"})
