from http import HTTPStatus

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from extensions import db
from models import User


users_bp = Blueprint("users", __name__, url_prefix="/users")


def _serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
    }


def _resolve_current_user() -> User | None:
    identity = get_jwt_identity()
    user = None
    if identity is not None:
        try:
            user_id = int(identity)
        except (TypeError, ValueError):
            user_id = None
        if user_id:
            user = User.query.get(user_id)
    if user is None:
        user = User.query.first()
    return user


@users_bp.route("/me", methods=["GET"])
@jwt_required(optional=True)
def get_profile():
    user = _resolve_current_user()
    if not user:
        return jsonify({"message": "User not found"}), HTTPStatus.NOT_FOUND
    return jsonify(_serialize_user(user)), HTTPStatus.OK


@users_bp.route("/me", methods=["PUT"])
@jwt_required(optional=True)
def update_profile():
    user = _resolve_current_user()
    if not user:
        return jsonify({"message": "User not found"}), HTTPStatus.NOT_FOUND

    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()

    if not username:
        return jsonify({"message": "Username is required"}), HTTPStatus.BAD_REQUEST

    if username != user.username:
        conflict = User.query.filter(User.username == username, User.id != user.id).first()
        if conflict:
            return jsonify({"message": "Username is already taken"}), HTTPStatus.CONFLICT
        user.username = username
        db.session.commit()

    return jsonify(_serialize_user(user)), HTTPStatus.OK


@users_bp.route("/me/password", methods=["POST"])
@jwt_required(optional=True)
def update_password():
    user = _resolve_current_user()
    if not user:
        return jsonify({"message": "User not found"}), HTTPStatus.NOT_FOUND

    payload = request.get_json(silent=True) or {}
    current_password = (payload.get("currentPassword") or "").strip()
    new_password = (payload.get("newPassword") or "").strip()

    if not current_password or not new_password:
        return jsonify({"message": "Current password and new password are required"}), HTTPStatus.BAD_REQUEST

    if len(new_password) < 8:
        return jsonify({"message": "New password must be at least 8 characters"}), HTTPStatus.BAD_REQUEST

    if not user.check_password(current_password):
        return jsonify({"message": "Current password is incorrect"}), HTTPStatus.FORBIDDEN

    user.set_password(new_password)
    db.session.commit()

    return jsonify({"message": "Password updated successfully"}), HTTPStatus.OK
