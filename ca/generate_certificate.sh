#!/bin/bash
# Generate CA certificate
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p $DIR/certs
openssl genrsa -out $DIR/certs/speedis-root-ca.key 4096
openssl req -new \
  -subj "/CN=Speedis Root CA/OU=Speedis/O=Speedis/L=Seville/ST=Andalucia/C=ES/" \
  -key $DIR/certs/speedis-root-ca.key \
  -out $DIR/certs/speedis-root-ca.csr
openssl x509 -req -days 3650 -sha256 \
  -in $DIR/certs/speedis-root-ca.csr \
  -out $DIR/certs/speedis-root-ca.crt \
  -signkey $DIR/certs/speedis-root-ca.key \
  -extfile <(cat <<-EOF
    extendedKeyUsage=serverAuth,clientAuth
    basicConstraints=CA:TRUE
EOF
)