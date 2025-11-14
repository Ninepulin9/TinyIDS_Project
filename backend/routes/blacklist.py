from http import HTTPStatus

from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError

from extensions import db
from models import Blacklist

blacklist_bp = Blueprint("blacklist", __name__, url_prefix="/blacklist")
DEFAULT_USER_ID = 1


def _resolve_user_id() -> int:
    identity = get_jwt_identity()
    if identity is None:
        return DEFAULT_USER_ID
    try:
        return int(identity)
    except (TypeError, ValueError):
        return DEFAULT_USER_ID


def _serialize_entry(entry) -> dict:
    ip_address = getattr(entry, "ip_address", None)
    reason = getattr(entry, "reason", None)
    created_at = getattr(entry, "created_at", None)
    created_value = (
        created_at.isoformat().replace("+00:00", "Z")
        if hasattr(created_at, "isoformat")
        else created_at
    )

    return {
        "id": getattr(entry, "id", None),
        "device_name": getattr(entry, "device_name", None) or "Unknown",
        "ip_address": ip_address,
        "reason": reason,
        "created_at": created_value,
    }


def _raw_blacklist_rows():
    rows = db.session.execute(
        text("SELECT id, ip_address, reason, created_at FROM blacklist ORDER BY created_at DESC")
    )
    for row in rows:
        yield row


@blacklist_bp.route("", methods=["GET"])
@jwt_required(optional=True)
def list_blacklist():
    user_id = _resolve_user_id()
    try:
        entries = (
            Blacklist.query.filter(Blacklist.user_id == user_id)
            .order_by(Blacklist.created_at.desc())
            .all()
        )
    except (OperationalError, ProgrammingError):
        entries = list(_raw_blacklist_rows())
    return jsonify([_serialize_entry(entry) for entry in entries])


@blacklist_bp.route("/<int:entry_id>", methods=["DELETE"])
@jwt_required(optional=True)
def delete_blacklist_entry(entry_id: int):
    user_id = _resolve_user_id()
    try:
        entry = (
            Blacklist.query.filter(Blacklist.id == entry_id, Blacklist.user_id == user_id)
            .first()
        )
        if not entry:
            return jsonify({"message": "Blacklist entry not found"}), HTTPStatus.NOT_FOUND

        db.session.delete(entry)
        db.session.commit()
        return "", HTTPStatus.NO_CONTENT
    except (OperationalError, ProgrammingError):
        db.session.execute(text("DELETE FROM blacklist WHERE id = :entry_id"), {"entry_id": entry_id})
        db.session.commit()
        return "", HTTPStatus.NO_CONTENT
