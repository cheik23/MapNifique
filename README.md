# MapNifique

Monorepo local préparé le 14 novembre 2026. `frontend/` est l’application principale; `backend/scraper/` fournit l’API et les tâches de collecte. L’ancienne app est conservée sous `archive/legacy-mapnifique/` à titre de référence.

## Arborescence

- `frontend/` — React, TypeScript, Vite, Leaflet/MapLibre/PMTiles.
- `backend/scraper/` — Node.js, Fastify, PostgreSQL/PostGIS, workers et scripts OSM.
- `archive/legacy-mapnifique/` — snapshot source de l’ancienne app Vite/JavaScript; exclue des commandes de build.

Le dépôt racine ne déclare pas de dépendances npm partagées : chaque app garde son manifeste et son lockfile afin d’éviter de mélanger les environnements browser et backend.

## Prérequis

- Node.js `>=22.13.0` recommandé pour le frontend et le scraper.
- Docker Desktop ou Docker Engine avec Compose v2 pour lancer localement PostgreSQL/PostGIS et les services backend.

## Installer, lancer et vérifier

```sh
npm --prefix frontend ci
npm --prefix backend/scraper ci
```

Copier `backend/scraper/.env.example` vers `backend/scraper/.env` et remplacer les valeurs factices localement. Ne jamais committer `.env`. Puis démarrer le backend depuis sa racine :

```sh
cd backend/scraper
docker compose up -d db api worker offers-worker
```

Le port API est lié à `127.0.0.1:8787`. Depuis la racine du monorepo, `npm run dev` lance Vite; son proxy `/api` relaie les appels vers cette API. En développement, `VITE_MAPNIFIQUE_API_URL` peut rester vide. Pour tout déploiement frontend ultérieur, le build doit recevoir l’URL HTTPS publique de l’API comme variable `VITE_MAPNIFIQUE_API_URL`; une variable `VITE_*` est publique et ne doit jamais contenir de secret. Aucun réglage Vercel n’est effectué par ce dépôt.

Les contrôles locaux disponibles depuis la racine :

```sh
npm run lint
npm run check:backend
npm run test:backend
npm run build
npm run verify
```

## Photon et synchronisation OSM

Le backend utilise `https://photon.komoot.io` par défaut pour le géocodage; `PHOTON_URL` peut pointer vers une instance Photon que tu contrôles. Pour un volume important, vérifier les conditions et limites de la source ou héberger une instance dédiée.

La synchronisation OSM est optionnelle et désactivée par défaut derrière le profil Compose `osm-sync`. Elle a besoin des fichiers locaux `osm-pilot.lua` et `osm-sync.pgpass`, stockés hors Git dans `backend/scraper/data/` ou dans le dossier défini par `MAPNIFIQUE_DATA_DIR`. Ces fichiers ne sont pas présents dans le dépôt. Après configuration, démarrer explicitement le profil :

```sh
cd backend/scraper
docker compose --profile osm-sync up -d osm-sync
```

`data/`, `.env*`, dumps, volumes, caches, dépendances et artefacts d’exécution sont ignorés par Git. Seuls les `.env.example` destinés à documenter les clés sont conservés; une valeur sensible trouvée dans l’exemple scraper a été remplacée dans cette copie.

## État de publication

Ce répertoire reste une copie de préparation. Aucun dépôt Git n’a été initialisé ici; aucun commit, push, lien Vercel ou déploiement n’a été effectué. La source distante `cheik23/MapNifique` doit être inspectée avec un accès GitHub autorisé avant d’y rattacher cette copie.
