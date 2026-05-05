interface PageCounterOptions {
  selector: string;
  onReached: () => void;
}

export interface PageCounterObserver {
  cleanup: () => void;
}

const COUNTER_REGEX = /(\d+)\s*\/\s*(\d+)/;

export function createPageCounterObserver(opts: PageCounterOptions): PageCounterObserver {
  let fired = false;
  let observer: MutationObserver | null = null;

  const check = () => {
    if (fired) return;
    const target = document.querySelector(opts.selector);
    if (!target) return;
    const text = target.textContent ?? '';
    const m = COUNTER_REGEX.exec(text);
    if (!m) return;
    const current = Number(m[1]);
    const total = Number(m[2]);
    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return;
    if (current >= total) {
      fired = true;
      opts.onReached();
    }
  };

  observer = new MutationObserver(check);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  check();

  return {
    cleanup() {
      observer?.disconnect();
      observer = null;
    },
  };
}
