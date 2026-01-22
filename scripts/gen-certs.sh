#!/usr/bin/env sh
set -eu

# Generate Mosquitto TLS certs for TinyIDS (dev/prod on Pi).

CERTS_DIR="${CERTS_PATH:-./mosquitto/certs}"

if [ -f "$CERTS_DIR/ca.crt" ] && [ -f "$CERTS_DIR/server.crt" ] && [ -f "$CERTS_DIR/server.key" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Certs already exist in $CERTS_DIR (set FORCE=1 to regenerate)."
  exit 0
fi

mkdir -p "$CERTS_DIR"

openssl genrsa -out "$CERTS_DIR/ca.key" 2048
openssl req -x509 -new -nodes -key "$CERTS_DIR/ca.key" -sha256 -days 3650 \
  -subj "/CN=TinyIDS-CA" -out "$CERTS_DIR/ca.crt"

openssl genrsa -out "$CERTS_DIR/server.key" 2048
openssl req -new -key "$CERTS_DIR/server.key" -subj "/CN=mosquitto" -out "$CERTS_DIR/server.csr"
openssl x509 -req -in "$CERTS_DIR/server.csr" -CA "$CERTS_DIR/ca.crt" -CAkey "$CERTS_DIR/ca.key" \
  -CAcreateserial -out "$CERTS_DIR/server.crt" -days 3650 -sha256

rm -f "$CERTS_DIR/server.csr" "$CERTS_DIR/ca.srl"

echo "Generated certs in $CERTS_DIR"
