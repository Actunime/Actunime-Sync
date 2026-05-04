/**
 * Wrapper typé autour de `chrome.storage.local` pour l'état persistent de
 * l'extension (auth, patterns appris, préférences, cache matching).
 */

import type { LearnedPattern } from './types';

export interface AuthState {
  accessToken: string;
  expiresAt: number; // timestamp ms
  user: {
    id: string;
    memberId: string;
    username: string;
    displayName?: string;
    avatarUrl?: string | null;
  };
}

export interface Preferences {
  autoConfirmOnExactMatch: boolean;
  silentMode: boolean;
  enabledSites: Record<string, boolean>;
}

export type MatchingEntry =
  | {
      kind: 'media';
      mediaId: string;
      mediaType: 'Anime' | 'Manga';
      title: string;
      coverUrl?: string | null;
      confirmedAt: number;
      isRewatch?: boolean;
      catchupTarget?: number;
    }
  | {
      kind: 'pending';
      listEntryId: string;
      mediaType: 'Anime' | 'Manga';
      title: string;
      coverUrl?: string | null;
      confirmedAt: number;
      catchupTarget?: number;
    };

export interface LocalState {
  auth: AuthState | null;
  /**
   * Cache des matchs validés. Clé : `seriesKey` (`siteId:seriesId` ou
   * `siteId:seriesSlug`) — un seul cache par série, pas par épisode.
   */
  matchings: Record<string, MatchingEntry>;
  /**
   * Séries explicitement ignorées par l'utilisateur (« Ne plus tracker cette
   * série »). Clé : même `seriesKey` que `matchings`.
   */
  ignoredSeries: Record<string, true>;
  /**
   * Hosts activés par l'user via le wizard du popup
   * (`chrome.permissions.request` + `scripting.registerContentScripts`).
   * Clé : hostname brut (ex. « www.netflix.com »).
   * Source de vérité au démarrage du SW pour ré-enregistrer les content scripts
   * (ils ne survivent pas à un reboot Chrome).
   */
  activatedHosts: Record<string, { activatedAt: number }>;
  /**
   * Flag transient set par le SW après une activation depuis le popup pour que
   * le content script qui s'injecte au reload sache qu'il doit lancer le wizard
   * automatiquement. Consommé (unset) au boot du content script si match.
   */
  pendingWizardForHost: string | null;
  /**
   * Demande de contribution déposée depuis la card in-page (l'user voit
   * « Pas dans Actunime » → clic « Proposer son ajout »). Le popup, à
   * l'ouverture, consomme cette demande pour ouvrir directement le form
   * `ContributionForm` pré-rempli.
   */
  pendingContribution: {
    kind?: 'anime' | 'manga';
    title: string;
    episode?: number;
    chapter?: number;
    season?: number;
    sourceUrl?: string;
    requestedAt: number;
  } | null;
  /**
   * Résultat du mode pick d'image (clic sur une image dans la page depuis le
   * popup ContributionForm). Contient le data URL base64 que le popup
   * consommera à sa prochaine ouverture.
   */
  pendingImagePickResult: string | null;
  /**
   * Patterns appris via le wizard de configuration (E17). Clé = hostname
   * (même convention que `activatedHosts`). Activation host et pattern sont
   * indépendants : un host activé sans pattern utilise la Couche 1 générique
   * (heuristique JSON-LD/OG/url) sans configuration explicite.
   */
  learnedPatterns: Record<string, LearnedPattern>;
  preferences: Preferences;
}

const DEFAULT_PREFERENCES: Preferences = {
  autoConfirmOnExactMatch: false,
  silentMode: false,
  enabledSites: {},
};

async function getAll(): Promise<LocalState> {
  const raw = (await chrome.storage.local.get(null)) as Partial<LocalState>;
  return {
    auth: raw.auth ?? null,
    matchings: raw.matchings ?? {},
    ignoredSeries: raw.ignoredSeries ?? {},
    activatedHosts: raw.activatedHosts ?? {},
    pendingWizardForHost: raw.pendingWizardForHost ?? null,
    pendingContribution: raw.pendingContribution ?? null,
    pendingImagePickResult: raw.pendingImagePickResult ?? null,
    learnedPatterns: raw.learnedPatterns ?? {},
    preferences: { ...DEFAULT_PREFERENCES, ...(raw.preferences ?? {}) },
  };
}

export const storage = {
  getAll,

  async getAuth(): Promise<AuthState | null> {
    const { auth } = (await chrome.storage.local.get('auth')) as { auth?: AuthState };
    if (!auth) return null;
    if (auth.expiresAt < Date.now()) return null;
    return auth;
  },

  async setAuth(auth: AuthState): Promise<void> {
    await chrome.storage.local.set({ auth });
  },

  async clearAuth(): Promise<void> {
    await chrome.storage.local.remove('auth');
  },

  async getPreferences(): Promise<Preferences> {
    const { preferences } = (await chrome.storage.local.get('preferences')) as {
      preferences?: Preferences;
    };
    return { ...DEFAULT_PREFERENCES, ...(preferences ?? {}) };
  },

  async setPreferences(patch: Partial<Preferences>): Promise<void> {
    const current = await this.getPreferences();
    await chrome.storage.local.set({ preferences: { ...current, ...patch } });
  },

  async getMatching(seriesKey: string): Promise<MatchingEntry | null> {
    const { matchings = {} } = (await chrome.storage.local.get('matchings')) as {
      matchings?: Record<string, MatchingEntry>;
    };
    return matchings[seriesKey] ?? null;
  },

  async setMatching(seriesKey: string, entry: MatchingEntry): Promise<void> {
    const { matchings = {} } = (await chrome.storage.local.get('matchings')) as {
      matchings?: Record<string, MatchingEntry>;
    };
    matchings[seriesKey] = entry;
    await chrome.storage.local.set({ matchings });
  },

  async isSeriesIgnored(seriesKey: string): Promise<boolean> {
    const { ignoredSeries = {} } = (await chrome.storage.local.get('ignoredSeries')) as {
      ignoredSeries?: Record<string, true>;
    };
    return ignoredSeries[seriesKey] === true;
  },

  async ignoreSeries(seriesKey: string): Promise<void> {
    const { ignoredSeries = {} } = (await chrome.storage.local.get('ignoredSeries')) as {
      ignoredSeries?: Record<string, true>;
    };
    ignoredSeries[seriesKey] = true;
    await chrome.storage.local.set({ ignoredSeries });
  },

  async getActivatedHosts(): Promise<Record<string, { activatedAt: number }>> {
    const { activatedHosts = {} } = (await chrome.storage.local.get('activatedHosts')) as {
      activatedHosts?: Record<string, { activatedAt: number }>;
    };
    return activatedHosts;
  },

  async addActivatedHost(host: string): Promise<void> {
    const current = await this.getActivatedHosts();
    current[host] = { activatedAt: Date.now() };
    await chrome.storage.local.set({ activatedHosts: current });
  },

  async removeActivatedHost(host: string): Promise<void> {
    const current = await this.getActivatedHosts();
    delete current[host];
    await chrome.storage.local.set({ activatedHosts: current });
  },

  async setPendingWizardForHost(host: string | null): Promise<void> {
    await chrome.storage.local.set({ pendingWizardForHost: host });
  },

  async setPendingContribution(req: LocalState['pendingContribution']): Promise<void> {
    await chrome.storage.local.set({ pendingContribution: req });
  },

  async getPendingContribution(): Promise<LocalState['pendingContribution']> {
    const { pendingContribution } = (await chrome.storage.local.get('pendingContribution')) as {
      pendingContribution?: LocalState['pendingContribution'];
    };
    return pendingContribution ?? null;
  },

  async clearPendingContribution(): Promise<void> {
    await chrome.storage.local.set({ pendingContribution: null });
  },

  async setPendingImagePickResult(dataUrl: string | null): Promise<void> {
    await chrome.storage.local.set({ pendingImagePickResult: dataUrl });
  },

  async getPendingImagePickResult(): Promise<string | null> {
    const { pendingImagePickResult } = (await chrome.storage.local.get(
      'pendingImagePickResult',
    )) as { pendingImagePickResult?: string | null };
    return pendingImagePickResult ?? null;
  },

  async consumePendingWizardForHost(host: string): Promise<boolean> {
    const { pendingWizardForHost } = (await chrome.storage.local.get('pendingWizardForHost')) as {
      pendingWizardForHost?: string | null;
    };
    if (pendingWizardForHost && pendingWizardForHost === host) {
      await chrome.storage.local.set({ pendingWizardForHost: null });
      return true;
    }
    return false;
  },

  async getLearnedPattern(host: string): Promise<LearnedPattern | null> {
    const { learnedPatterns = {} } = (await chrome.storage.local.get('learnedPatterns')) as {
      learnedPatterns?: Record<string, LearnedPattern>;
    };
    return learnedPatterns[host] ?? null;
  },

  async setLearnedPattern(pattern: LearnedPattern): Promise<void> {
    const { learnedPatterns = {} } = (await chrome.storage.local.get('learnedPatterns')) as {
      learnedPatterns?: Record<string, LearnedPattern>;
    };
    learnedPatterns[pattern.host] = pattern;
    await chrome.storage.local.set({ learnedPatterns });
  },

  async removeLearnedPattern(host: string): Promise<void> {
    const { learnedPatterns = {} } = (await chrome.storage.local.get('learnedPatterns')) as {
      learnedPatterns?: Record<string, LearnedPattern>;
    };
    delete learnedPatterns[host];
    await chrome.storage.local.set({ learnedPatterns });
  },

  async listLearnedPatterns(): Promise<LearnedPattern[]> {
    const { learnedPatterns = {} } = (await chrome.storage.local.get('learnedPatterns')) as {
      learnedPatterns?: Record<string, LearnedPattern>;
    };
    return Object.values(learnedPatterns);
  },

  /** Oublie le match cache + lève l'éventuel ignore — pour le bouton « Modifier » du badge. */
  async forgetMatch(seriesKey: string): Promise<void> {
    const { matchings = {}, ignoredSeries = {} } = (await chrome.storage.local.get([
      'matchings',
      'ignoredSeries',
    ])) as {
      matchings?: Record<string, MatchingEntry>;
      ignoredSeries?: Record<string, true>;
    };
    delete matchings[seriesKey];
    delete ignoredSeries[seriesKey];
    await chrome.storage.local.set({ matchings, ignoredSeries });
  },

  /**
   * Écoute les changements sur une clé donnée. Utile pour propager l'état d'auth
   * depuis le popup vers les content scripts, ou pour invalider un cache.
   */
  onChanged<K extends keyof LocalState>(
    key: K,
    callback: (newValue: LocalState[K] | undefined, oldValue: LocalState[K] | undefined) => void,
  ): () => void {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      if (!(key in changes)) return;
      callback(changes[key].newValue as LocalState[K], changes[key].oldValue as LocalState[K]);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  },
};
