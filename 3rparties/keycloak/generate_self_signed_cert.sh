#!/bin/sh
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout keycloak.key \
  -out keycloak.crt \
  -config san.cnf
mkdir ./certs
mv keycloak.key keycloak.crt ./certs

