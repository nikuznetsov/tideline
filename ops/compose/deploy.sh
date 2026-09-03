#!/bin/sh
# Deploy/redeploy on the VM: git pull -> build -> migrate -> restart app.
# Run from ops/compose: ./deploy.sh
set -eu

cd "$(dirname "$0")"

git -C ../.. pull --ff-only
docker compose build migrate
docker compose run --rm migrate
docker compose up -d app caddy
docker compose ps
