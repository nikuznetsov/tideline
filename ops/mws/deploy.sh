#!/bin/sh
# Деплой/передеплой на VM: git pull -> build -> migrate -> перезапуск app.
# Запускать из ops/mws: ./deploy.sh
set -eu

cd "$(dirname "$0")"

git -C ../.. pull --ff-only
docker compose build migrate
docker compose run --rm migrate
docker compose up -d app caddy
docker compose ps
