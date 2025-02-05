#!/bin/sh 
# openssl genpkey -algorithm RSA -out mocks.key -aes256
openssl genpkey -algorithm RSA -out mocks.key
openssl req -new -key mocks.key -out mocks.csr
openssl x509 -req -in mocks.csr -signkey mocks.key -out mocks.crt -days 365
cat mocks.crt mocks.key > certs/mocks.pem
