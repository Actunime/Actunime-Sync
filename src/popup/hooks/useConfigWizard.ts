import { useCallback, useEffect, useState } from 'react';
import { sendMessage } from '@/shared/messaging';
import type { LearnedPattern } from '@/shared/types';

interface UseConfigWizardResult {
  pattern: LearnedPattern | null;
  loading: boolean;
  /** Lance le wizard côté content script. La promesse résout quand l'user a fini ou annulé. */
  launchWizard: () => Promise<void>;
  /** Retire le pattern appris pour le host courant. */
  removePattern: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Message d'erreur si le wizard n'a pas pu s'ouvrir sur la page (sinon null). */
  launchError: string | null;
}

export function useConfigWizard(host: string | null): UseConfigWizardResult {
  const [pattern, setPattern] = useState<LearnedPattern | null>(null);
  const [loading, setLoading] = useState(true);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!host) {
      setPattern(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = (await sendMessage({
      type: 'GET_LEARNED_PATTERN',
      payload: { host },
    })) as { pattern: LearnedPattern | null };
    setPattern(res.pattern);
    setLoading(false);
  }, [host]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Réagit aux changements de storage (sauvegarde depuis le wizard pendant que le popup est ouvert).
  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !host) return;
      if (!('learnedPatterns' in changes)) return;
      const next = (changes.learnedPatterns.newValue ?? {}) as Record<string, LearnedPattern>;
      setPattern(next[host] ?? null);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [host]);

  const launchWizard = useCallback(async () => {
    setLaunchError(null);
    const res = (await sendMessage({ type: 'LAUNCH_CONFIG_WIZARD' })) as {
      ok?: boolean;
      cancelled?: boolean;
      error?: string;
    } | null;
    // Le content script ne répond qu'à la fin du wizard : une erreur ici veut dire
    // que l'assistant n'a pas pu s'ouvrir — on garde le popup ouvert pour l'afficher.
    if (res && !res.ok && !res.cancelled) {
      setLaunchError(res.error ?? "L'assistant n'a pas pu s'ouvrir sur cette page.");
      return;
    }
    // Le wizard est en overlay in-page : on ferme le popup pour que l'user voie la page.
    // `chrome.storage.onChanged` met `pattern` à jour après la sauvegarde.
    window.close();
  }, []);

  const removePattern = useCallback(async () => {
    if (!host) return;
    await sendMessage({ type: 'REMOVE_LEARNED_PATTERN', payload: { host } });
    setPattern(null);
  }, [host]);

  return { pattern, loading, launchWizard, removePattern, refresh, launchError };
}
