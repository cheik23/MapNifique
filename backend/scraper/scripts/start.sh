#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker n'est pas installÃ© ou n'est pas accessible depuis WSL."
  echo "Installe/active Docker Desktop avec l'intÃ©gration WSL2, puis relance ce script."
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Le plugin Docker Compose est absent. Installe Docker Compose v2 puis rÃ©essaie."
  exit 1
fi

if [[ ! -f .env ]]; then
  command -v openssl >/dev/null 2>&1 || { echo "openssl est requis pour crÃ©er un mot de passe sÃ»r."; exit 1; }
  database_secret="$(openssl rand -hex 24)"
  admin_secret="$(openssl rand -hex 32)"
  sed \
    -e "s/replace-with-a-long-random-password/${database_secret}/g" \
    -e "s/replace-with-a-long-random-admin-token/${admin_secret}/g" \
    .env.example > .env
  chmod 600 .env
  echo "Fichier .env crÃ©Ã© avec un mot de passe alÃ©atoire. Garde-le privÃ©."
fi

echo "DÃ©marrage de PostgreSQL, de l'API et du worker..."
docker compose up -d --build
echo
echo "Ã‰tat des services :"
docker compose ps
echo
echo "Test API :"
curl --retry 12 --retry-delay 2 --retry-connrefused -fsS http://127.0.0.1:8787/health || true
echo
echo "API locale : http://127.0.0.1:8787"

