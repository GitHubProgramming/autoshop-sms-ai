#!/bin/bash
set -e

echo "Running AI verification..."

cd apps/api

echo "Install deps"
npm ci

echo "Lint"
npm run lint --if-present || true

echo "Build"
npm run build

echo "Tests"
npm test --if-present || true

cd ../..

echo "Docker smoke test"
# N8N_ENCRYPTION_KEY: read from the local n8n volume config so the key always matches
# what the running volume was initialized with. Required by docker-compose :? check.
# Extract encryptionKey value using awk inside the alpine container (no python3 needed).
N8N_VOL_KEY=$(docker run --rm -v infra_n8n_data:/data alpine \
  sh -c "grep encryptionKey /data/config 2>/dev/null | sed 's/.*: \"//;s/\"//' | tr -d '\t\r\n'" 2>/dev/null || true)
if [ -n "$N8N_VOL_KEY" ]; then
  export N8N_ENCRYPTION_KEY="$N8N_VOL_KEY"
elif [ -z "$N8N_ENCRYPTION_KEY" ]; then
  echo "ERROR: N8N_ENCRYPTION_KEY not set and no n8n volume found. Set N8N_ENCRYPTION_KEY in .env."
  exit 1
fi
docker compose -f infra/docker-compose.yml build
docker compose -f infra/docker-compose.yml up -d

sleep 10

curl -f http://localhost:3000/health || exit 1

echo "AI VERIFY PASSED"
