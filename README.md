# Actunime Sync

> Extension navigateur de synchronisation automatique des animes & mangas avec [Actunime](https://actunime.fr).

[![Licence : GPL-3.0](https://img.shields.io/badge/licence-GPL--3.0-blue.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/Actunime/Actunime-Sync?include_prereleases)](https://github.com/Actunime/Actunime-Sync/releases)
[![Manifest V3](https://img.shields.io/badge/manifest-V3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)

Actunime Sync détecte automatiquement les épisodes que tu regardes sur les sites
de streaming et synchronise ta progression avec ta liste Actunime — sans copier-coller,
sans clic à chaque épisode.

## Fonctionnalités

- **Mise à jour automatique** de ta liste Actunime au fil de tes visionnages, ou
  marquage immédiat depuis le popup via le bouton « Marquer vu ».
- **Configuration par site** via un assistant qui teste 4 stratégies de détection
  (JSON-LD / Open Graph / tokens d'URL / sélecteurs DOM) — fallback sélecteur
  visuel pour pointer manuellement le titre et l'épisode dans la page.
- **Contribution rapide** : si une œuvre n'est pas encore dans Actunime, un mini
  formulaire dans le popup permet de la proposer en quelques secondes ; elle est
  ajoutée à ta liste immédiatement (en attente de validation par les modérateurs).
- **Dédup communautaire** : si plusieurs utilisateurs proposent la même œuvre,
  l'extension les agrège automatiquement en un seul appui sur la proposition existante.
- **Export / import** des configurations de sites en JSON pour partager avec
  d'autres utilisateurs.
- **Aucun pattern précâblé** : tout est configuré par toi (ou importé depuis un
  partage communautaire). L'extension n'embarque aucune connaissance préalable
  des sites.

## Installation

### Pour les utilisateurs (release stable)

1. Télécharge la dernière `actunime-sync-vX.Y.Z.zip` depuis la page
   [Releases GitHub](https://github.com/Actunime/Actunime-Sync/releases/latest).
2. Décompresse l'archive dans un dossier dédié.
3. Ouvre `chrome://extensions` (ou `edge://extensions`).
4. Active le **Mode développeur** (interrupteur en haut à droite).
5. Clique **« Charger l'extension non empaquetée »** et sélectionne le dossier décompressé.
6. Connecte-toi à Actunime depuis le popup de l'extension.
7. Visite un site de streaming, clique l'icône Actunime Sync dans la barre d'outils,
   puis **« Ajouter ce site »** — l'assistant de configuration s'ouvre.

### Pour les développeurs

```bash
git clone https://github.com/Actunime/Actunime-Sync.git
cd Actunime-Sync
pnpm install
pnpm build
```

Charge ensuite le dossier `dist/` via `chrome://extensions` comme ci-dessus.

Pour le développement avec hot-reload :

```bash
pnpm dev
```

## Architecture

L'extension est en **Manifest V3** avec quatre contextes d'exécution :

| Contexte | Rôle | Stack |
|---|---|---|
| **Popup** | UI rapide : détection, suivi, contribution | React + Tailwind |
| **Options** | Configuration globale, sites & patterns | React + Tailwind |
| **Service worker** | Auth, appels API, matching, coordination | TypeScript pur |
| **Content script** | Détection in-page, observateurs vidéo/audio, overlays | Vanilla TS + Shadow DOM |

Voir la [documentation contributeur](CONTRIBUTING.md) pour plus de détails sur la
structure du code, le flow de configuration par site et les règles de matching.

## Confidentialité

- Aucun tracking publicitaire, aucune télémétrie.
- Les **patterns appris localement** (mode manuel) ne quittent **jamais** ton
  navigateur sauf si tu les exportes explicitement en JSON.
- Seules les progressions d'épisodes (titre + numéro) sont envoyées à l'API Actunime,
  exactement comme si tu cliquais « marqué vu » sur le site.
- Le code source est intégralement public sous licence GPL-3.0 et auditable.

## Licence

[GPL-3.0-or-later](LICENSE) — toute redistribution ou modification doit rester
sous la même licence (copyleft).

Le **nom « Actunime » et le logo sont des marques** de leur propriétaire. Un fork
est libre, mais doit utiliser un autre nom et logo distincts.

## Liens

- 🌐 Site Actunime : [actunime.fr](https://actunime.fr)
- 📦 Releases : [github.com/Actunime/Actunime-Sync/releases](https://github.com/Actunime/Actunime-Sync/releases)
- 🐛 Bugs & demandes : [Issues GitHub](https://github.com/Actunime/Actunime-Sync/issues)
- 🤝 Contribuer : [CONTRIBUTING.md](CONTRIBUTING.md)
- 📝 Historique : [CHANGELOG.md](CHANGELOG.md)
