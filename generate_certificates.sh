#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
$DIR/ca/generate_certificate.sh
$DIR/conf/generate_certificate.sh
$DIR/mocks/generate_certificate.sh
$DIR/3rparties/haproxy/generate_certificate.sh
