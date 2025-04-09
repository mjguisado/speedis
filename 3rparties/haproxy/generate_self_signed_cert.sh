#!/bin/sh

# Generate a unique private key (KEY)
openssl genpkey -algorithm RSA -out mocks.local.key
# Generating a Certificate Signing Request (CSR) using the private key (KEY)
openssl req -new -key mocks.local.key -out mocks.local.csr \
    -subj "/C=ES/ST=Madrid/L=Madrid/O=Redis Ltd./OU=CS/CN=mocks.local/emailAddress=manuel.guisado@redis.com"
# Generate a self-signed certificate (CRT) using the CSR and private key (KEY)
openssl x509 -req -in mocks.local.csr -signkey mocks.local.key -out mocks.local.crt -days 365
# Concatenate the private key (KEY) and the certificate (CRT) into a single file (PEM)
cat mocks.local.crt mocks.local.key > certs/mocks.local.pem
# Remove the private key (KEY), CSR, and certificate (CRT)
# rm mocks.local.key mocks.local.csr mocks.local.crt
