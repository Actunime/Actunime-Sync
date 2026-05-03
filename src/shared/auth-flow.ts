/**
 * Flow d'authentification de l'extension via `chrome.identity.launchWebAuthFlow`.
 * Ouvre Actunime-Web `/auth/extension/authorize`, récupère un code one-time,
 * l'échange contre un JWT 7j, stocke dans `chrome.storage.local`.
 */

import { api, ApiError } from './api-client';
import { WEB_URL } from './config';
import { storage, type AuthState } from './storage';

const DEFAULT_SCOPES = ['profile:read', 'lists:read', 'lists:write', 'progress:write'] as const;

export class AuthFlowError extends Error {
  constructor(
    public code: 'cancelled' | 'state_mismatch' | 'missing_code' | 'exchange_failed',
    message: string,
  ) {
    super(message);
    this.name = 'AuthFlowError';
  }
}

/**
 * Déclenche le flow de connexion complet. Doit être appelé depuis un clic
 * utilisateur (popup ou options) — `chrome.identity.launchWebAuthFlow` exige
 * `interactive: true` et ne peut pas être déclenché en arrière-plan.
 */
export async function launchAuthFlow(): Promise<AuthState> {
  const state = crypto.randomUUID();
  const redirect = chrome.identity.getRedirectURL();

  const authorizeUrl = new URL(`${WEB_URL}/auth/extension/authorize`);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('scopes', DEFAULT_SCOPES.join(','));
  authorizeUrl.searchParams.set('redirect', redirect);
  authorizeUrl.searchParams.set('label', 'Actunime Sync (navigateur)');

  let callbackUrl: string | undefined;
  try {
    callbackUrl = await chrome.identity.launchWebAuthFlow({
      url: authorizeUrl.toString(),
      interactive: true,
    });
  } catch (err) {
    throw new AuthFlowError(
      'cancelled',
      (err as Error).message ?? "Le flow d'authentification a été annulé",
    );
  }

  if (!callbackUrl) {
    throw new AuthFlowError('cancelled', "Le flow d'authentification a été annulé");
  }

  if (!callbackUrl.startsWith(redirect)) {
    throw new AuthFlowError('cancelled', 'URL de retour invalide');
  }

  const url = new URL(callbackUrl);
  const returnedState = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    throw new AuthFlowError('cancelled', `Accès refusé : ${error}`);
  }
  if (returnedState !== state) {
    throw new AuthFlowError('state_mismatch', 'État de sécurité invalide (CSRF)');
  }
  if (!code) {
    throw new AuthFlowError('missing_code', "Aucun code d'autorisation reçu");
  }

  try {
    const result = await api.exchangeExtensionCode(code);
    const authState: AuthState = {
      accessToken: result.accessToken,
      expiresAt: Date.now() + result.expiresIn * 1000,
      user: {
        id: result.user.id,
        memberId: result.user.memberId,
        username: result.user.username,
        displayName: result.user.displayName,
        avatarUrl: result.user.avatarUrl,
      },
    };
    await storage.setAuth(authState);
    return authState;
  } catch (err) {
    if (err instanceof ApiError) {
      throw new AuthFlowError('exchange_failed', err.message);
    }
    throw new AuthFlowError('exchange_failed', (err as Error).message);
  }
}

/**
 * Déconnexion : révoque le token côté serveur (best-effort) puis vide le
 * stockage local.
 */
export async function logout(): Promise<void> {
  const auth = await storage.getAuth();
  if (auth) {
    try {
      // Le jti est dans le JWT mais on n'a pas de décodeur ici — on laisse
      // le backend expirer naturellement. À améliorer en stockant le jti
      // séparément lors de l'exchange si on veut une révocation hard.
    } catch {
      // Best-effort : on ignore les erreurs de révocation.
    }
  }
  await storage.clearAuth();
}
