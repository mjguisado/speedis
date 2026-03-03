#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p $DIR/certs
openssl genrsa -out $DIR/certs/mocks.key 4096
openssl req -new \
  -subj "/CN=mocks/OU=Mocks/O=Speedis/L=Seville/ST=Andalucia/C=ES/" \
  -key $DIR/certs/mocks.key \
  -out $DIR/certs/mocks.csr
openssl x509 -req -days 365 -sha256 \
  -in  $DIR/certs/mocks.csr \
  -out $DIR/certs/mocks.crt \
  -CA $DIR/../ca/certs/speedis-root-ca.crt -CAkey $DIR/../ca/certs/speedis-root-ca.key \
  -extfile <(cat <<-EOF
    extendedKeyUsage=serverAuth
    subjectAltName=\
      DNS:mocks,\
      DNS:mocks.localhost\
EOF
)
