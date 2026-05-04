# Guide du contributeur

Merci de l'intérêt que tu portes à Actunime Sync 🙏

Ce document décrit les conventions de contribution, la structure du code et le
processus de release. **Toute la documentation projet est en français** —
seuls les identifiants techniques (noms de fichiers, types, branches) restent en anglais.

## Pré-requis

- **Node.js 22+**
- **pnpm 9+**
- Un navigateur Chromium (Chrome, Edge, Brave…) ou Firefox récent

Aucune dépendance privée, aucun PAT GitHub à configurer pour cloner et builder.

## Démarrage

```bash
git clone https://github.com/Actunime/Actunime-Sync.git
cd Actunime-Sync
pnpm install
```

Crée un fichier `.env.development` à la racine avec les URL de l'API et du site
Actunime que tu utilises (laisse `localhost` pour le développement local) :

```env
VITE_API_URL=http://localhost:3000
VITE_WEB_URL=http://localhost:3002
```

Puis lance le build watch :

```bash
pnpm dev
```

Charge le dossier `dist/` via `chrome://extensions` → mode développeur →
« Charger l'extension non empaquetée ».

## Scripts utiles

| Commande | Description |
|---|---|
| `pnpm dev` | Build watch mode (HMR) |
| `pnpm build` | Build production (TypeScript check + Vite). Mode `development` ou `production` selon `--mode` |
| `pnpm build:icons` | Régénère les icônes 16/32/48/128 depuis `public/icons/source.png` |
| `pnpm type-check` | Vérification TypeScript sans émission |
| `pnpm lint` | ESLint avec auto-fix |
| `pnpm format` | Prettier |
| `pnpm test` | Vitest |

## Structure du code

```
src/
├── background/      Service worker MV3 : auth, appels API, matching
├── content/         Content scripts injectés dans les pages
│   ├── strategies/  4 stratégies de détection (jsonld, og, url-tokens, dom-selectors)
│   ├── progress/    Observateurs vidéo et audio
│   ├── wizard.ts    Assistant de configuration par site
│   ├── overlay.ts   Cards Shadow DOM (confirmation, badges)
│   └── main.ts      Point d'entrée content script
├── popup/           UI React du popup (auth, détection, contribution)
├── options/         UI React de la page d'options (sites configurés, import/export)
└── shared/          Types, storage, messaging, api-client partagés
```

## Conventions

### TypeScript

- **Strict mode**, pas de `any`.
- Path alias `@/` pointe vers `src/`.
- Interfaces préfixées `I` (ex. `IDetectionResult`).
- Types union via `type`, pas `interface`.

### Composants React (popup, options)

- Exports nommés uniquement, jamais d'export default.
- Props enveloppés en `Readonly<>`.
- `cn()` (clsx + tailwind-merge) pour la composition de classes.

### Styling

- Tailwind CSS utilitaire-d'abord, classes custom préfixées `act-`.
- Variables CSS dans `src/theme.css`, mobile-first (`sm:`, `md:`, `lg:`).

## Conventional Commits (obligatoire)

Les commits doivent respecter le format Conventional Commits — semantic-release
les analyse pour générer automatiquement les changelogs et bumper la version.

Format : `type(scope): description`

### Types acceptés

| Type | Bump | Description |
|---|---|---|
| `feat` | minor | Nouvelle fonctionnalité |
| `fix` | patch | Correction de bug |
| `refactor` | patch | Refactoring sans changement fonctionnel |
| `perf` | patch | Amélioration de performance |
| `docs` | patch | Documentation uniquement |
| `style` | patch | Mise en forme code (espaces, virgules…) |
| `chore` | patch | Maintenance (deps, config…) |
| `test` | aucun | Ajout ou correction de tests |
| `revert` | patch | Annulation d'un commit précédent |

### Scopes acceptés

`popup`, `options`, `background`, `content`, `wizard`, `strategies`, `overlay`,
`progress`, `image-pick`, `shared`, `messaging`, `storage`, `api-client`,
`auth-flow`, `update-checker`, `manifest`, `theme`, `deps`, `config`, `ci`,
`release`, `docs`.

La liste exhaustive est définie dans `commitlint.config.mjs` à la racine.

### Exemples

```
feat(wizard): support des 4 stratégies de détection
fix(content): pick visuel ne capturait pas les <img> dans des wrappers
refactor(strategies): extraire la logique commune dans strategies/index
docs(readme): ajouter la section confidentialité
chore(deps): bump react vers 19.2.4
```

Husky bloque les commits non conformes via `commitlint`. Si tu n'arrives pas à
formuler un commit, ouvre une issue avant de coder pour qu'on aligne le scope.

## Branches

- **`production`** : releases stables, push uniquement via merge depuis `beta` après QA.
- **`beta`** : branche par défaut pour le développement et les pre-releases.
   Chaque push déclenche `semantic-release` qui crée une release `vX.Y.Z-beta.N`
   sur GitHub avec le `.zip` du build attaché.
- **`feat/*`, `fix/*`, `refactor/*`** : branches de travail. PR vers `beta`.

## Pull requests

1. Fork → branche locale (`feat/ma-feature`).
2. Code + tests si applicable.
3. `pnpm build` doit passer en vert localement.
4. Push + PR vers `beta` avec un titre Conventional Commit.
5. Décris le problème résolu, comment tester, screenshots si UI.
6. Attendez la review.

Les PR avec des commits non-conformes ou un build cassé seront refusés
automatiquement par le CI.

## Tests

Pour V0.x les tests automatisés sont limités (le projet est très lié au DOM
des sites tiers). La majorité de la validation se fait manuellement :

1. Build + chargement de l'extension dans Chrome.
2. Test du flow complet : ajout d'un site → wizard → lecture d'un épisode →
   confirmation → push de progression.
3. Vérification dans `chrome://extensions` → service worker → console pour les logs `[Actunime]`.
4. Vérification dans Network du service worker pour les appels API.

## Code de conduite

Sois respectueux. Pas de harcèlement, pas de discrimination, pas de troll. Les
mainteneurs se réservent le droit de bannir tout contributeur qui ne respecte
pas ce principe.

## Licence

En contribuant, tu acceptes que ta contribution soit publiée sous **GPL-3.0-or-later**
(la même licence que le projet). Tu conserves tes droits d'auteur sur tes ajouts
mais accordes une licence GPL irrévocable.
