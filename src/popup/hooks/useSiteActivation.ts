import { useCallback, useEffect, useState } from 'react';
import {
  sendMessage,
  type ActivateHostResultPayload,
  type CheckHostStateResultPayload,
  type HostActivationState,
} from '@/shared/messaging';

interface UseSiteActivationResult {
  host: string | null;
  state: HostActivationState | null;
  canActivate: boolean;
  activating: boolean;
  activate: () => Promise<void>;
  lastResult: ActivateHostResultPayload | null;
}

export function useSiteActivation(): UseSiteActivationResult {
  const [host, setHost] = useState<string | null>(null);
  const [canActivate, setCanActivate] = useState(false);
  const [state, setState] = useState<HostActivationState | null>(null);
  const [activating, setActivating] = useState(false);
  const [lastResult, setLastResult] = useState<ActivateHostResultPayload | null>(null);

  const refresh = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url;
    if (!url) {
      setHost(null);
      setCanActivate(false);
      setState(null);
      return;
    }
    let hostname: string;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        setHost(null);
        setCanActivate(false);
        setState(null);
        return;
      }
      hostname = u.hostname;
    } catch {
      setHost(null);
      setCanActivate(false);
      setState(null);
      return;
    }

    setHost(hostname);
    setCanActivate(true);

    const check = (await sendMessage({
      type: 'CHECK_HOST_STATE',
      payload: { host: hostname },
    })) as CheckHostStateResultPayload;
    setState(check.state);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-synchronise toutes les instances du hook quand `activatedHosts` change
  // dans le storage. Sinon `SiteActivationCard` (qui a fait l'activation) et
  // `SiteConfigWizardCard` (qui calcule sa visibilité depuis `state`) ne se
  // parlent pas et il faut fermer/ré-ouvrir le popup pour voir le nouveau state.
  useEffect(() => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      if (!('activatedHosts' in changes)) return;
      void refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [refresh]);

  const activate = useCallback(async () => {
    if (!host) return;
    setActivating(true);
    setLastResult(null);
    try {
      const res = (await sendMessage({
        type: 'ACTIVATE_HOST',
        payload: { host },
      })) as ActivateHostResultPayload;
      setLastResult(res);
      if (res.ok) {
        setState('activated');
        window.close();
      }
    } finally {
      setActivating(false);
    }
  }, [host]);

  return { host, state, canActivate, activating, activate, lastResult };
}
