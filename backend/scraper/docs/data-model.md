# Modèle de données

- `sources` : configuration par site officiel (domaine, cadence, sélecteurs, règles d'URL).
- `scrape_jobs` : file persistante de tâches avec état, compteurs et erreurs.
- `products` : fiche normalisée par source et URL produit.
- `price_observations` : snapshots datés, dédupliqués par produit et par jour avec prix, devise, promotion, disponibilité, magasin et portée du prix.

La séparation produit / observation de prix évite de dupliquer la fiche complète à chaque actualisation. Les observations historiques sont conservées.
