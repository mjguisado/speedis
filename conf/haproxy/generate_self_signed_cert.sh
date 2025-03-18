#!/bin/sh

# Generate a unique private key (KEY)
openssl genpkey -algorithm RSA -out mocks.speedis.key
# Generating a Certificate Signing Request (CSR) using the private key (KEY)
openssl req -new -key mocks.speedis.key -out mocks.speedis.csr \
    -subj "/C=ES/ST=Madrid/L=Madrid/O=Redis Ltd./OU=CS/CN=mocks.speedis/emailAddress=manuel.guisado@redis.com"
# Generate a self-signed certificate (CRT) using the CSR and private key (KEY)
openssl x509 -req -in mocks.speedis.csr -signkey mocks.speedis.key -out mocks.speedis.crt -days 365
# Concatenate the private key (KEY) and the certificate (CRT) into a single file (PEM)
cat mocks.speedis.crt mocks.speedis.key > certs/mocks.speedis.pem
# Remove the private key (KEY), CSR, and certificate (CRT)
rm mocks.speedis.key mocks.speedis.csr mocks.speedis.crt
