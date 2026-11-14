# Backend MapNifique Scraper

Backend complémentaire de `frontend/`: API Node.js/Fastify, PostgreSQL/PostGIS et workers de collecte. Le frontend utilise les mêmes routes publiques `/api/search/intelligent`, `/api/offers`, `/api/offers/brands`, `/api/discover` et `/api/route`.

## Prérequis

- Node.js 22.13 ou ultérieur et npm.
- Docker Engine/Desktop avec Docker Compose v2.

## Démarrage local

Depuis `backend/scraper/`, prépare `.env` à partir du modèle et remplace les valeurs factices. Le script génère automatiquement des secrets locaux si `.env` n’existe pas :

```bash
cp .env.example .env
chmod 600 .env
# Remplacer les valeurs factices de mot de passe et de jeton admin.
docker compose up -d db api worker offers-worker
```

Ou lance `bash scripts/start.sh`; il crée un mot de passe DB et un jeton admin aléatoires dans `.env` avec les permissions locales restreintes, puis lance les services. `.env` reste ignoré par Git.

L’API est publiée uniquement sur `127.0.0.1:8787` pour le développement local; PostgreSQL n’a pas de port hôte publié. Le serveur Vite du monorepo relaie `/api` vers cette adresse. Photon utilise `https://photon.komoot.io` par défaut; `PHOTON_URL` peut pointer vers une instance que tu contrôles.

Vérifier l’API et les tests sans démarrer Docker :

```bash
npm run check
npm test
```

Depuis la racine du monorepo, les équivalents sont `npm run check:backend` et `npm run test:backend`.

## Synchronisation OSM facultative

Le service Compose `osm-sync` est désactivé par défaut. Pour l’activer, placer `osm-pilot.lua` et `osm-sync.pgpass` dans le dossier local `data/` ignoré par Git, ou définir `MAPNIFIQUE_DATA_DIR` dans `.env` vers un répertoire local contenant ces fichiers. Protéger `osm-sync.pgpass` (mode `600` sous Linux), puis lancer :

```bash
docker compose --profile osm-sync up -d osm-sync
```

Aucun de ces fichiers ni les extraits PBF ne sont requis pour la recherche Overpass/Photon standard ou pour les builds. Les fichiers de données OSM, secrets, volumes et sauvegardes locales ne doivent pas être ajoutés au dépôt.

## Endpoints d’administration

Les routes `POST /api/sources`, `POST /api/crawls` et `POST /api/offers` exigent l’en-tête `x-admin-token`, comparé à `PLACES_ADMIN_TOKEN`. Les routes de lecture publique comprennent `/api/products`, `/api/places`, `/api/offers` et les routes de recherche. Exemple local après avoir chargé `.env` sans l’imprimer :

```bash
set -a; . ./.env; set +a
curl -X POST http://127.0.0.1:8787/api/sources \
  -H 'Content-Type: application/json' \
  -H "x-admin-token: ${PLACES_ADMIN_TOKEN}" \
  -d '{"id":"mon-enseigne","name":"Mon enseigne","baseUrl":"https://www.exemple.fr","requestsPerMinute":12,"sameDomainDelaySecs":2,"maxPagesPerRun":100}'
```

N’utilise pas d’enseigne avant d’avoir vérifié ses conditions d’utilisation, droits de réutilisation et règles `robots.txt`. Le scraper ne contourne pas les CAPTCHA, connexions, restrictions techniques ou blocages.

## Sauvegarde

`bash scripts/backup.sh` écrit un dump dans `backups/`, dossier ignoré par Git. Le volume Docker `postgres_data` conserve les données locales; ne lance pas `docker compose down -v` si tu veux garder ce volume. Cette procédure locale ne remplace pas des sauvegardes cloud chiffrées et testées pour la production.

## Production

La configuration Docker Compose de ce dossier est destinée au développement local. La production doit héberger API, DB et workers dans le cloud, derrière HTTPS et des contrôles d’accès adaptés, indépendamment du PC, de WSL et de Docker Desktop. L’URL publique de l’API est une variable de build publique du frontend (`VITE_MAPNIFIQUE_API_URL`); les mots de passe et jetons restent exclusivement côté serveur. Aucun déploiement ou changement Vercel n’est fait ici.
