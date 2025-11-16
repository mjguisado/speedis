#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout $DIR/mocks.key \
  -out $DIR/mocks.crt \
  -config $DIR/san.cnf \
  -extensions req_ext
mkdir -p $DIR/certs
cat $DIR/mocks.crt $DIR/mocks.key > $DIR/certs/mocks.pem
