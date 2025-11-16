#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
redis-cli -u redis://redis:6379 -x JSON.SET 'origin:mocks' . < $DIR/origins/mocks.json
redis-cli -u redis://redis:6379 -x JSON.SET 'origin:mocks2' . < $DIR/origins/mocks2.json