from datetime import datetime, timedelta
from http import HTTPStatus

from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token

from extensions import db
from models import User


auth_bp = Blueprint("auth", __name__, url_prefix="/auth")


@auth_bp.route("/register", methods=["POST"])
def register():
    payload = request.get_json(force=True)
    username = payload.get("username")
    email = payload.get("email")
    password = payload.get("password")

    if not all([username, email, password]):
        return jsonify({"message": "username, email, and password are required"}), HTTPStatus.BAD_REQUEST

    if User.query.filter((User.username == username) | (User.email == email)).first():
        return jsonify({"message": "User already exists"}), HTTPStatus.CONFLICT

    user = User(username=username, email=email)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    access_token = create_access_token(identity=str(user.id))
    return (
        jsonify({"access_token": access_token, "user": {"id": user.id, "username": user.username}}),
        HTTPStatus.CREATED,
    )


@auth_bp.route("/login", methods=["POST"])
def login():
    payload = request.get_json(force=True)
    identifier = payload.get("username") or payload.get("email")
    password = payload.get("password")

    if not all([identifier, password]):
        return jsonify({"message": "username/email and password required"}), HTTPStatus.BAD_REQUEST

    user = User.query.filter(
        (User.username == identifier) | (User.email == identifier)
    ).first()
    if not user:
        return jsonify({"message": "Invalid email or password"}), HTTPStatus.UNAUTHORIZED

    if user.lockout_until and user.lockout_until > datetime.utcnow():
        return (
            jsonify({"message": "Too many failed attempts. Please wait 5 minutes."}),
            HTTPStatus.TOO_MANY_REQUESTS,
        )

    if not user.check_password(password):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        if user.failed_login_attempts >= 3:
            user.lockout_until = datetime.utcnow() + timedelta(minutes=5)
            user.failed_login_attempts = 0
        db.session.commit()
        return jsonify({"message": "Invalid email or password"}), HTTPStatus.UNAUTHORIZED

    if user.failed_login_attempts or user.lockout_until:
        user.failed_login_attempts = 0
        user.lockout_until = None
        db.session.commit()

    access_token = create_access_token(identity=str(user.id))
    return jsonify({"access_token": access_token, "user": {"id": user.id, "username": user.username}})
