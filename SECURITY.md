# Politique de sécurité

## Versions supportées

Seule la dernière version `beta` (et la dernière `production` quand elle sera publiée) reçoit des correctifs de sécurité. Les anciennes pre-releases ne sont pas patchées rétroactivement.

## Signaler une vulnérabilité

**Ne créez pas d'issue publique pour une faille de sécurité.**

Utilisez le canal privé GitHub :

➡️ [Ouvrir un Security Advisory privé](https://github.com/Actunime/Actunime-Sync/security/advisories/new)

À défaut, écris à `contact@actunime.fr` avec le sujet `[SECURITY]`. La clé de chiffrement PGP n'est pas encore disponible — joins simplement le rapport en texte.

### Ce qu'on attend du rapport

- Description de la faille et impact estimé.
- Étapes de reproduction (URL, version de l'extension, navigateur).
- Si possible : un proof-of-concept minimal.
- Versions affectées.

### Ce qu'on s'engage à faire

- Accuser réception sous **72 heures**.
- Évaluer et confirmer la faille sous **7 jours**.
- Publier un correctif sous **30 jours** pour les failles critiques, **90 jours** pour les autres.
- Te créditer dans les notes de release (sauf si tu préfères rester anonyme).

## Périmètre

Sont concernés :

- Le code de l'extension (service worker, content scripts, popup, options).
- Les patterns de détection (XSS via injection de pattern malveillant, par exemple).
- La gestion du token d'authentification et des appels API.

Sont **hors périmètre** :

- Les vulnérabilités de l'API Actunime (signaler sur le repo de l'API).
- Les sites tiers que l'extension lit (Crunchyroll, ADN, etc.).
- Les attaques nécessitant un accès physique à la machine de l'utilisateur.
