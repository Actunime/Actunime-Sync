import { useEffect, useState } from 'react';
import type { UpdateInfo } from '@/background/update-checker';

export function useUpdateInfo(): UpdateInfo | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    void chrome.storage.local.get('updateInfo').then((r) => {
      setInfo((r as { updateInfo?: UpdateInfo }).updateInfo ?? null);
    });
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local' || !('updateInfo' in changes)) return;
      setInfo((changes.updateInfo.newValue as UpdateInfo | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  return info;
}
