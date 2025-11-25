#!/bin/sh
./conf/generate_self_signed_cert.sh
openssl x509 -in ./conf/certs/speedis.crt -noout -issuer -subject -ext subjectAltName
./3rparties/haproxy/generate_self_signed_cert.sh
openssl x509 -in ./3rparties/haproxy/mocks.crt -noout -issuer -subject -ext subjectAltName
./3rparties/keycloak/generate_self_signed_cert.sh
openssl x509 -in ./3rparties/keycloak/certs/keycloak.crt -noout -issuer -subject -ext subjectAltName
./mocks/generate_self_signed_cert.sh
openssl x509 -in ./mocks/certs/mocks.crt -noout -issuer -subject -ext subjectAltName
