import os


class Settings:
    SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key")
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://tinyids:tinyids@db:3306/tinyids",
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "super-secret-jwt")
    JWT_ACCESS_TOKEN_EXPIRES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES", 604800))
    JWT_DECODE_OPTIONS = {"verify_sub": False}
    PROPAGATE_EXCEPTIONS = True
    ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:5173")
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", ALLOWED_ORIGIN)
    SOCKETIO_MESSAGE_QUEUE = os.getenv("SOCKETIO_MESSAGE_QUEUE")
    MQTT_BROKER_URL = os.getenv("MQTT_BROKER_URL", "mosquitto")
    MQTT_BROKER_PORT = int(os.getenv("MQTT_BROKER_PORT", 1883))
    MQTT_TOPICS = os.getenv("MQTT_TOPICS")
    MQTT_TOPIC = os.getenv("MQTT_TOPIC", "tinyids/logs")
    MQTT_USERNAME = os.getenv("MQTT_USERNAME", "")
    MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
    MQTT_TLS_ENABLED = os.getenv("MQTT_TLS_ENABLED", "false").lower() == "true"
    MQTT_TLS_CA_CERTS = os.getenv("MQTT_TLS_CA_CERTS")
    MQTT_TLS_INSECURE = os.getenv("MQTT_TLS_INSECURE", "false").lower() == "true"
    MQTT_DISCOVERY_INTERVAL = int(os.getenv("MQTT_DISCOVERY_INTERVAL", 15))
    MQTT_ALLOW_REREGISTER = os.getenv("MQTT_ALLOW_REREGISTER", "false").lower() == "true"


settings = Settings()
