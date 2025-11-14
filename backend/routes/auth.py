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
    if not user or not user.check_password(password):
        return jsonify({"message": "Email หรือรหัสผ่านของท่านไม่ถูกต้อง กรุณาลองใหม่"}), HTTPStatus.UNAUTHORIZED

    access_token = create_access_token(identity=str(user.id))
    return jsonify({"access_token": access_token, "user": {"id": user.id, "username": user.username}})
