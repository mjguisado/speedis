#!/bin/sh
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout mocks.key \
  -out mocks.crt \
  -config san.cnf
mkdir ./certs
cat mocks.crt mocks.key > certs/mocks.pem
