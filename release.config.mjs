/**
 * Configuration semantic-release pour Actunime Sync.
 *
 * Différences avec les libs (`@actunime/types`, `validations`, `client`, `ui`) :
 *  - Pas de plugin `@semantic-release/npm` : on ne publie pas sur npm, l'extension
 *    est distribuée uniquement via les Releases GitHub.
 *  - Plugin `@semantic-release/github` configuré pour **attacher le `.zip`** du
 *    build comme asset de release (téléchargeable par les utilisateurs).
 *
 * Branches :
 *  - `beta` (par défaut)   → pre-releases `vX.Y.Z-beta.N`
 *  - `production`          → releases stables `vX.Y.Z`
 *
 * @type {import('semantic-release').GlobalConfig}
 */
export default {
  branches: ['production', { name: 'beta', prerelease: true }],
  repositoryUrl: 'https://github.com/Actunime/Actunime-Sync',
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        releaseRules: [
          { type: 'refactor', release: 'patch' },
          { type: 'feat', release: 'minor' },
          { type: 'fix', release: 'patch' },
          { type: 'perf', release: 'patch' },
          { type: 'docs', release: 'patch' },
          { type: 'chore', release: 'patch' },
          { type: 'style', release: 'patch' },
          { type: 'test', release: false },
          { type: 'revert', release: 'patch' },
        ],
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        presetConfig: {
          types: [
            { type: 'feat', section: '🚀 Fonctionnalités' },
            { type: 'fix', section: '🐛 Corrections' },
            { type: 'refactor', section: '♻️ Refactoring' },
            { type: 'perf', section: '⚡ Performance' },
            { type: 'docs', section: '📝 Documentation' },
            { type: 'chore', section: '🔧 Maintenance' },
            { type: 'style', section: '🎨 Style' },
            { type: 'revert', section: '⏪ Retours en arrière' },
          ],
        },
        writerOpts: {
          commitsSort: ['subject', 'scope'],
          noteGroupsSort: 'title',
          notesSort: 'title',
        },
      },
    ],
    '@semantic-release/changelog',
    [
      '@semantic-release/github',
      {
        // Le `.zip` est généré par le workflow CI juste avant `semantic-release`.
        // Le pattern `dist/actunime-sync-*.zip` capture le fichier nommé avec la
        // version (ex. `actunime-sync-v0.2.0-beta.3.zip`).
        assets: [
          {
            path: 'dist/actunime-sync-*.zip',
            label: 'Extension empaquetée (.zip)',
          },
        ],
        successComment: false,
        failComment: false,
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['package.json', 'CHANGELOG.md', 'pnpm-lock.yaml', 'manifest.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
  ],
};
