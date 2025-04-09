#!/bin/sh

# Generate a unique private key (KEY)
openssl genpkey -algorithm RSA -out keycloak.local.key
# Generating a Certificate Signing Request (CSR) using the private key (KEY)
openssl req -new -key keycloak.local.key -out keycloak.local.csr \
    -subj "/C=ES/ST=Madrid/L=Madrid/O=Redis Ltd./OU=CS/CN=keycloak.local/emailAddress=manuel.guisado@redis.com"
# Generate a self-signed certificate (CRT) using the CSR and private key (KEY)
openssl x509 -req -in keycloak.local.csr -signkey keycloak.local.key -out keycloak.local.crt -days 365
# Move the certificate and the private key
mv keycloak.local.crt ./certs
mv keycloak.local.key ./certs
