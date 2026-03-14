#!/bin/bash

PROMPT="$1"

curl -s http://localhost:3030/ask-openai \
  -H "x-bridge-token: $BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"$PROMPT\"}" \
  | jq -r ".answer"
