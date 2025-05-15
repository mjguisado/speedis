#!/bin/sh
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout $DIR/keycloak.key \
  -out $DIR/keycloak.crt \
  -config $DIR/san.cnf
mkdir -p $DIR/certs
mv $DIR/keycloak.key $DIR/keycloak.crt $DIR/certs
