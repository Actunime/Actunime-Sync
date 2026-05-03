import { defineManifest } from '@crxjs/vite-plugin';
import { loadEnv } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineManifest(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  const apiUrl = env.VITE_API_URL;
  const webUrl = env.VITE_WEB_URL;

  if (!apiUrl) {
    throw new Error(
      `VITE_API_URL non définie pour le mode "${mode}". Crée un fichier .env.${mode} ou injecte la variable au build.`,
    );
  }
  if (!webUrl) {
    throw new Error(
      `VITE_WEB_URL non définie pour le mode "${mode}". Crée un fichier .env.${mode} ou injecte la variable au build.`,
    );
  }

  const apiOrigin = new URL(apiUrl).origin;
  const webOrigin = new URL(webUrl).origin;
  const webHostname = new URL(webUrl).hostname;
  const isLocalWeb =
    webHostname === 'localhost' ||
    webHostname === '127.0.0.1' ||
    webHostname.endsWith('.localhost');

  const markerMatches = isLocalWeb
    ? [`${webOrigin}/*`]
    : [`${webOrigin}/*`, `https://*.${webHostname}/*`];

  const isProd = mode === 'production';

  return {
    manifest_version: 3,
    name: isProd ? 'Actunime Sync' : `Actunime Sync (${mode})`,
    version: pkg.version,
    description: pkg.description,
    homepage_url: 'https://github.com/Actunime/Actunime-Sync',
    author: { email: 'contact@actunime.fr' },
    icons: {
      16: 'public/icons/icon-16.png',
      32: 'public/icons/icon-32.png',
      48: 'public/icons/icon-48.png',
      128: 'public/icons/icon-128.png',
    },
    action: {
      default_popup: 'src/popup/index.html',
      default_title: 'Actunime Sync',
      default_icon: {
        16: 'public/icons/icon-16.png',
        32: 'public/icons/icon-32.png',
        48: 'public/icons/icon-48.png',
        128: 'public/icons/icon-128.png',
      },
    },
    options_page: 'src/options/index.html',
    background: {
      service_worker: 'src/background/index.ts',
      type: 'module',
    },
    content_scripts: [
      {
        matches: ['https://placeholder.actunime-sync.invalid/*'],
        js: ['src/content/main.ts'],
        run_at: 'document_idle',
        all_frames: true,
      },
      {
        matches: markerMatches,
        js: ['src/content/marker.ts'],
        run_at: 'document_start',
        all_frames: false,
      },
    ],
    permissions: ['storage', 'activeTab', 'identity', 'scripting', 'alarms'],
    host_permissions: [`${apiOrigin}/*`, `${webOrigin}/*`],
    optional_host_permissions: ['https://*/*'],
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; img-src 'self' data: https: ${apiOrigin} ${webOrigin}; connect-src 'self' ${apiOrigin} ${webOrigin} https://api.github.com`,
    },
    web_accessible_resources: [
      {
        resources: ['assets/*'],
        matches: ['<all_urls>'],
      },
    ],
  };
});
