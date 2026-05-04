const RELEASES_API = 'https://api.github.com/repos/Actunime/Actunime-Sync/releases?per_page=1';
const UPDATE_ALARM = 'actunime-sync-update-check';
const CHECK_PERIOD_MINUTES = 24 * 60;

export interface UpdateInfo {
  available: boolean;
  latestVersion?: string;
  releaseUrl?: string;
  checkedAt: number;
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/);
  const pb = b.replace(/^v/, '').split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = parseInt(pa[i] ?? '0', 10);
    const bi = parseInt(pb[i] ?? '0', 10);
    if (!isNaN(ai) && !isNaN(bi)) {
      if (ai !== bi) return ai - bi;
    } else {
      const cmp = (pa[i] ?? '').localeCompare(pb[i] ?? '');
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

export async function checkForUpdate(): Promise<void> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return;
    const data = (await res.json()) as Array<{ tag_name?: string; html_url?: string }>;
    const top = data[0];
    if (!top) return;
    const latest = top.tag_name;
    const releaseUrl = top.html_url;
    if (!latest) return;
    const current = chrome.runtime.getManifest().version;
    const available = compareVersions(latest, current) > 0;
    const info: UpdateInfo = {
      available,
      latestVersion: latest,
      releaseUrl,
      checkedAt: Date.now(),
    };
    await chrome.storage.local.set({ updateInfo: info });
    if (available) {
      try {
        await chrome.action.setBadgeText({ text: '↑' });
        await chrome.action.setBadgeBackgroundColor({ color: '#3c5aa6' });
      } catch {
        // ignore
      }
    }
  } catch {
    // best-effort, retry à l'alarm suivante
  }
}

export function setupUpdateChecker(): void {
  chrome.alarms.create(UPDATE_ALARM, {
    periodInMinutes: CHECK_PERIOD_MINUTES,
    delayInMinutes: 1,
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === UPDATE_ALARM) void checkForUpdate();
  });
  void checkForUpdate();
}
