#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p $DIR/certs
openssl genrsa -out $DIR/certs/speedis.key 4096
openssl req -new \
  -subj "/CN=speedis/OU=Speedis/O=Speedis/L=Seville/ST=Andalucia/C=ES/" \
  -key $DIR/certs/speedis.key \
  -out $DIR/certs/speedis.csr
openssl x509 -req -days 365 -sha256 \
  -in  $DIR/certs/speedis.csr \
  -out $DIR/certs/speedis.crt \
  -CA $DIR/../ca/certs/speedis-root-ca.crt -CAkey $DIR/../ca/certs/speedis-root-ca.key \
  -extfile <(cat <<-EOF
    extendedKeyUsage=serverAuth
    subjectAltName=\
      DNS:speedis,\
      DNS:speedis.localhost
EOF
)
