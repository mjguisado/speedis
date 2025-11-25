#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
awk 'BEGIN{printf "\"key\":  \""}  {gsub(/"/,"\\\""); printf "%s\\n", $0} END{printf "\",\n"}' $DIR/certs/speedis.key
awk 'BEGIN{printf "\"cert\":  \""} {gsub(/"/,"\\\""); printf "%s\\n", $0} END{printf "\"\n"}' $DIR/certs/speedis.crt
