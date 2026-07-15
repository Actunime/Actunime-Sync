# [1.0.0-beta.6](https://github.com/Actunime/Actunime-Sync/compare/v1.0.0-beta.5...v1.0.0-beta.6) (2026-07-15)


### Bug Fixes

* **content:** différer la discovery manga jusqu'à stabilité du titre ([d417b4b](https://github.com/Actunime/Actunime-Sync/commit/d417b4be935af045a9adeefcb9bad1bf46c98e56))
* **overlay:** élisions françaises dans le badge de suivi ([fd08576](https://github.com/Actunime/Actunime-Sync/commit/fd08576bf9588adf8c8c173ab1e9a16739b65dd0))
* **popup:** élisions françaises dans les messages de contribution ([c7f801e](https://github.com/Actunime/Actunime-Sync/commit/c7f801e6241c2954e3bf5628a7b625566d558890))
* **detection:** la stratégie configurée prime sur le numéro extrait de l'URL ([01aaa84](https://github.com/Actunime/Actunime-Sync/commit/01aaa8481e88d4ecefc4009815adfb754644cf13))

# [1.0.0-beta.5](https://github.com/Actunime/Actunime-Sync/compare/v1.0.0-beta.4...v1.0.0-beta.5) (2026-05-05)


### Bug Fixes

* **ci:** bump package.json before build so the zipped manifest.json carries the new version ([79cc7c1](https://github.com/Actunime/Actunime-Sync/commit/79cc7c1d4be10865072a255a0997e37a5d3c6c90))
* **lint:** clear all 13 ESLint warnings ([755841a](https://github.com/Actunime/Actunime-Sync/commit/755841a0b85aba00bfb8bd8430d034068a69f49b))
* **formatlint:** fix code warn ([1291879](https://github.com/Actunime/Actunime-Sync/commit/1291879dc8dea58527df92cfc5ab7b9f1497205d))
* **update-checker:** use /releases?per_page=1 instead of /releases/latest ([5ab1b86](https://github.com/Actunime/Actunime-Sync/commit/5ab1b86e5f5dc0218b79ff11f2cb25c7ad10ab1a))

# [1.0.0-beta.4](https://github.com/Actunime/Actunime-Sync/compare/v1.0.0-beta.3...v1.0.0-beta.4) (2026-05-04)


### Bug Fixes

* **manifest:** convert semver prerelease to Chrome-compatible version ([7181156](https://github.com/Actunime/Actunime-Sync/commit/718115647aed488870025e8ebc4d9ce25146743c))


### Features

* **detection:** add document-title strategy + shared title parser ([408dd3a](https://github.com/Actunime/Actunime-Sync/commit/408dd3aae2984ad2ef9a76bfcf79eb271532ad89))
* **resume:** experimental "Reprendre" button on watching badge ([06406ac](https://github.com/Actunime/Actunime-Sync/commit/06406ac4e189fab72a88e1da0423731900c3d61d))
* **progress:** replace video observer with scroll/page-counter/next-button ([269599f](https://github.com/Actunime/Actunime-Sync/commit/269599f2ee40675ae50b5dd97794e8a5155ee29a))

# [1.0.0-beta.3](https://github.com/Actunime/Actunime-Sync/compare/v1.0.0-beta.2...v1.0.0-beta.3) (2026-05-04)


### Bug Fixes

* **release:** bumper package.json automatiquement via @semantic-release/npm ([4d97bd7](https://github.com/Actunime/Actunime-Sync/commit/4d97bd70bfacb327b0c4af4134273400b211f96a))

# [1.0.0-beta.2](https://github.com/Actunime/Actunime-Sync/compare/v1.0.0-beta.1...v1.0.0-beta.2) (2026-05-03)


### Bug Fixes

* **ci:** ajoute GITHUB_TOKEN au step de génération du .zip ([f3231c9](https://github.com/Actunime/Actunime-Sync/commit/f3231c97c7d0dff62e64771961471423c3100360))

# 1.0.0-beta.1 (2026-05-03)


### Features

* extension v0.1 — tracking, auth and configuration wizard ([4b93dc5](https://github.com/Actunime/Actunime-Sync/commit/4b93dc5ac722f8587e82a17381c64bea6990549d))

# Changelog

Toutes les modifications notables d'Actunime Sync sont documentées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et les versions
respectent [SemVer](https://semver.org/lang/fr/).

Les sections de chaque release sont générées automatiquement par
[semantic-release](https://github.com/semantic-release/semantic-release) à partir des
[Conventional Commits](https://www.conventionalcommits.org/fr/v1.0.0/).

<!-- semantic-release injectera les nouvelles entrées au-dessus de cette ligne -->
