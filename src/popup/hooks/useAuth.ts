import { useEffect, useState } from 'react';
import { storage, type AuthState } from '@/shared/storage';

interface UseAuthResult {
  auth: AuthState | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Lit l'état d'auth depuis `chrome.storage.local` et reste en sync via
 * `chrome.storage.onChanged` (propagation quand le flow se termine dans un
 * autre contexte).
 */
export function useAuth(): UseAuthResult {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const current = await storage.getAuth();
    setAuth(current);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const unsubscribe = storage.onChanged('auth', (newValue) => {
      setAuth(newValue ?? null);
    });
    return unsubscribe;
  }, []);

  return { auth, loading, refresh };
}
