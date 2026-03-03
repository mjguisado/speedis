#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p $DIR/certs
openssl genrsa -out $DIR/certs/keycloak.key 4096
openssl req -new \
  -subj "/CN=keycloak/OU=Keycloak/O=Speedis/L=Seville/ST=Andalucia/C=ES/" \
  -key $DIR/certs/keycloak.key \
  -out $DIR/certs/keycloak.csr
openssl x509 -req -days 365 -sha256 \
  -in  $DIR/certs/keycloak.csr \
  -out $DIR/certs/keycloak.crt \
  -CA $DIR/../../ca/certs/speedis-root-ca.crt -CAkey $DIR/../../ca/certs/speedis-root-ca.key \
  -extfile <(cat <<-EOF
    extendedKeyUsage=serverAuth
    subjectAltName=\
      DNS:keycloak,\
      DNS:keycloak.localhost\
EOF
)
