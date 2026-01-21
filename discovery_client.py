"""
Simple MQTT discovery/confirmation helper for Raspberry Pi.

Flow:
1) Publish {"cmd": "DISCOVER", "nonce": "<nonce>"} to the discovery topic.
2) Wait for a device reply containing device_id, token, and the same nonce.
3) Send plaintext "Confirm-<nonce>-<token>" back on the same topic.
4) Optional: wait for a plaintext "Confirm" from the device to verify.

Environment variables (defaults are aimed at this TinyIDS stack):
  MQTT_HOST           mosquitto
  MQTT_PORT           8883
  MQTT_USE_TLS        true
  MQTT_CA_CERTS       ./mosquitto/certs/ca.crt
  MQTT_USERNAME       (optional)
  MQTT_PASSWORD       (optional)
  DISCOVERY_TOPIC     esp/Entrance
  NONCE_LENGTH        8
  WAIT_DEVICE_SEC     10
  WAIT_CONFIRM_SEC    5
"""

import argparse
import json
import os
import secrets
import string
import threading
import time
from typing import Optional

import paho.mqtt.client as mqtt


def generate_nonce(length: int = 8) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(max(1, min(length, 10))))


class DiscoveryClient:
    def __init__(
        self,
        host: str,
        port: int,
        topic: str,
        use_tls: bool = True,
        ca_certs: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        wait_device_sec: int = 10,
        wait_confirm_sec: int = 5,
    ) -> None:
        self.host = host
        self.port = port
        self.topic = topic
        self.wait_device_sec = wait_device_sec
        self.wait_confirm_sec = wait_confirm_sec

        self.client = mqtt.Client()
        if username:
            self.client.username_pw_set(username, password)
        if use_tls:
            self.client.tls_set(ca_certs=ca_certs)

        self.nonce: Optional[str] = None
        self.device_reply = threading.Event()
        self.device_id: Optional[str] = None
        self.token: Optional[str] = None
        self.confirm_reply = threading.Event()

        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, rc):  # noqa: D401
        if rc == 0:
            client.subscribe(self.topic)
        else:
            print(f"[!] MQTT connect failed rc={rc}")

    def _on_message(self, client, userdata, msg):
        try:
            text = msg.payload.decode("utf-8", errors="replace").strip()
        except Exception:
            return

        # Handle JSON reply from device (expects device_id, token, nonce)
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = None

        if payload and isinstance(payload, dict):
            nonce = payload.get("nonce")
            token = payload.get("token")
            device_id = payload.get("device_id")
            if self.nonce and nonce == self.nonce and token and device_id:
                self.device_id = str(device_id)
                self.token = str(token)
                self.device_reply.set()
                return

        # Handle plaintext confirm from device
        if text.lower().startswith("confirm"):
            self.confirm_reply.set()

    def start(self):
        self.client.connect(self.host, self.port, keepalive=30)
        self.client.loop_start()

    def stop(self):
        try:
            self.client.loop_stop()
        finally:
            try:
                self.client.disconnect()
            except Exception:
                pass

    def publish_discover(self, nonce: str):
        payload = {"cmd": "DISCOVER", "nonce": nonce}
        self.client.publish(self.topic, json.dumps(payload), qos=0, retain=False)
        self.nonce = nonce
        print(f"[>] Sent DISCOVER with nonce={nonce} on topic {self.topic}")

    def publish_confirm(self):
        if not self.nonce or not self.token:
            return
        message = f"Confirm-{self.nonce}-{self.token}"
        self.client.publish(self.topic, message, qos=0, retain=False)
        print(f"[>] Sent confirm: {message}")

    def run_once(self, nonce: str):
        self.publish_discover(nonce)

        if not self.device_reply.wait(timeout=self.wait_device_sec):
            print(f"[!] No device reply within {self.wait_device_sec}s for nonce={nonce}")
            return False

        print(f"[<] Device reply: device_id={self.device_id}, token={self.token}, nonce={self.nonce}")
        self.publish_confirm()

        if self.confirm_reply.wait(timeout=self.wait_confirm_sec):
            print("[<] Device acknowledged Confirm")
        else:
            print(f"[i] No explicit Confirm ack within {self.wait_confirm_sec}s (may still be registered)")
        return True


def parse_args():
    parser = argparse.ArgumentParser(description="TinyIDS ESP discovery helper")
    parser.add_argument("--topic", default=os.getenv("DISCOVERY_TOPIC", "esp/Entrance"))
    parser.add_argument("--host", default=os.getenv("MQTT_HOST", "mosquitto"))
    parser.add_argument("--port", type=int, default=int(os.getenv("MQTT_PORT", 8883)))
    parser.add_argument("--no-tls", action="store_true", help="Disable TLS")
    parser.add_argument("--ca-certs", default=os.getenv("MQTT_CA_CERTS", "./mosquitto/certs/ca.crt"))
    parser.add_argument("--username", default=os.getenv("MQTT_USERNAME"))
    parser.add_argument("--password", default=os.getenv("MQTT_PASSWORD"))
    parser.add_argument("--nonce-length", type=int, default=int(os.getenv("NONCE_LENGTH", 8)))
    parser.add_argument("--wait-device", type=int, default=int(os.getenv("WAIT_DEVICE_SEC", 10)))
    parser.add_argument("--wait-confirm", type=int, default=int(os.getenv("WAIT_CONFIRM_SEC", 5)))
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    client = DiscoveryClient(
        host=args.host,
        port=args.port,
        topic=args.topic,
        use_tls=not args.no_tls,
        ca_certs=args.ca_certs,
        username=args.username,
        password=args.password,
        wait_device_sec=args.wait_device,
        wait_confirm_sec=args.wait_confirm,
    )

    nonce = generate_nonce(args.nonce_length)
    client.start()
    try:
        client.run_once(nonce)
    finally:
        # allow time for final async acks
        time.sleep(1)
        client.stop()
