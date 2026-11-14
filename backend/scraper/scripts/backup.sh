#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Fichier .env absent. Lance d'abord scripts/start.sh."; exit 1; }
set -a
# shellcheck disable=SC1091
. ./.env
set +a
mkdir -p backups
file="backups/mapnifique-scraper-$(date +%Y%m%d-%H%M%S).sql"
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-mapnifique}" "${POSTGRES_DB:-mapnifique_scraper}" > "$file"
echo "Sauvegarde créée : $file"
