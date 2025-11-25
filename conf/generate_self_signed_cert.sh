#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout $DIR/speedis.key \
  -out $DIR/speedis.crt \
  -config $DIR/san.cnf \
  -extensions req_ext
mkdir -p $DIR/certs
mv $DIR/speedis.crt $DIR/speedis.key $DIR/certs
