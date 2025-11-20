#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
redis-cli -u redis://redis:6379 -x JSON.SET 'speedis:config:main' . < $DIR/speedis.json
redis-cli -u redis://redis:6379 -x JSON.SET 'speedis:config:origins:mocks' . < $DIR/origins/mocks.json
redis-cli -u redis://redis:6379 -x JSON.SET 'speedis:config:origins:mocks2' . < $DIR/origins/mocks2.json
