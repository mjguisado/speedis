#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p $DIR/certs
openssl genrsa -out $DIR/certs/haproxy.key 4096
openssl req -new \
  -subj "/CN=haproxy/OU=HAProxy/O=Speedis/L=Seville/ST=Andalucia/C=ES/" \
  -key $DIR/certs/haproxy.key \
  -out $DIR/certs/haproxy.csr
openssl x509 -req -days 365 -sha256 \
  -in  $DIR/certs/haproxy.csr \
  -out $DIR/certs/haproxy.crt \
  -CA $DIR/../../ca/certs/speedis-root-ca.crt -CAkey $DIR/../../ca/certs/speedis-root-ca.key \
  -extfile <(cat <<-EOF
    extendedKeyUsage=serverAuth
    subjectAltName=\
      DNS:oauth,\
      DNS:oauth.localhost,\
      DNS:mocks,\
      DNS:mocks.localhost,\
      DNS:speedis,\
      DNS:speedis.localhost
EOF
)
cat $DIR/certs/haproxy.crt $DIR/certs/haproxy.key > $DIR/certs/haproxy.pem
rm $DIR/certs/haproxy.key $DIR/certs/haproxy.csr $DIR/certs/haproxy.crt