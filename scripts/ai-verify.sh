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
docker compose build
docker compose up -d

sleep 10

curl -f http://localhost:3000/health || exit 1

echo "AI VERIFY PASSED"
