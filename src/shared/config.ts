const RAW_API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const RAW_WEB_URL = (import.meta.env.VITE_WEB_URL as string | undefined)?.trim();

function assertConfigured(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} non définie : le build doit injecter cette variable via .env (ex. ${name}=https://api.actunime.fr).`,
    );
  }
  return value;
}

function isLoopbackHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  );
}

function isPrivateIp(host: string): boolean {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function assertSecureUrl(name: string, value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} (${value}) n'est pas une URL valide.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${name} doit utiliser http(s) (reçu : ${parsed.protocol}).`);
  }
  if (
    parsed.protocol === 'http:' &&
    !isLoopbackHost(parsed.hostname) &&
    !isPrivateIp(parsed.hostname)
  ) {
    throw new Error(
      `${name} doit être en HTTPS pour les hôtes publics (reçu : ${value}). Le HTTP n'est autorisé que pour localhost et les IP privées.`,
    );
  }
  return value;
}

export const API_URL = assertSecureUrl(
  'VITE_API_URL',
  assertConfigured('VITE_API_URL', RAW_API_URL),
);

export const WEB_URL = assertSecureUrl(
  'VITE_WEB_URL',
  assertConfigured('VITE_WEB_URL', RAW_WEB_URL),
);
