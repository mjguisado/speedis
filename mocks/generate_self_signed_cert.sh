#!/bin/sh
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout $DIR/mocks.key \
  -out $DIR/mocks.crt \
  -config $DIR/san.cnf
mkdir -p $DIR/certs
mv $DIR/mocks.crt $DIR/mocks.key $DIR/certs
