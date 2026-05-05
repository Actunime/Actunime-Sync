interface ScrollObserverOptions {
  threshold?: number;
  containerSelector?: string;
  onReached: () => void;
}

export interface ScrollObserver {
  cleanup: () => void;
}

const INITIAL_DELAY_MS = 3_000;

type ScrollTarget = { element: HTMLElement | null; isWindow: boolean };

function isScrollable(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight + 4) return false;
  const style = getComputedStyle(el);
  return style.overflowY === 'auto' || style.overflowY === 'scroll';
}

function findScrollContainer(): ScrollTarget {
  const docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  if (docHeight > window.innerHeight + 100) {
    return { element: null, isWindow: true };
  }

  let best: HTMLElement | null = null;
  let bestArea = 0;
  const all = document.querySelectorAll<HTMLElement>('div, main, section, article');
  for (const el of all) {
    if (!isScrollable(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 300 || rect.height < 300) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return { element: best, isWindow: false };
}

function readScrollMetrics(target: ScrollTarget): {
  scrollTop: number;
  viewport: number;
  total: number;
} {
  if (target.isWindow) {
    return {
      scrollTop: window.scrollY || document.documentElement.scrollTop || 0,
      viewport: window.innerHeight || document.documentElement.clientHeight,
      total: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    };
  }
  const el = target.element;
  if (!el) return { scrollTop: 0, viewport: 0, total: 0 };
  return {
    scrollTop: el.scrollTop,
    viewport: el.clientHeight,
    total: el.scrollHeight,
  };
}

export function createScrollObserver(opts: ScrollObserverOptions): ScrollObserver {
  const threshold = opts.threshold ?? 0.9;
  const armedAt = Date.now();
  let fired = false;
  let userScrolled = false;
  let pageLoaded = document.readyState === 'complete';
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let target: ScrollTarget = { element: null, isWindow: true };

  const resolveTarget = () => {
    if (opts.containerSelector) {
      const el = document.querySelector<HTMLElement>(opts.containerSelector);
      if (el) {
        target = { element: el, isWindow: false };
        return;
      }
    }
    target = findScrollContainer();
  };

  resolveTarget();

  const onLoad = () => {
    pageLoaded = true;
    if (!target.isWindow && !target.element) resolveTarget();
  };
  if (!pageLoaded) {
    window.addEventListener('load', onLoad, { once: true });
  }

  const check = () => {
    if (fired) return;
    if (!userScrolled) return;
    if (!pageLoaded) return;
    if (Date.now() - armedAt < INITIAL_DELAY_MS) return;

    const { scrollTop, viewport, total } = readScrollMetrics(target);
    if (total <= viewport * 2) return;

    const ratio = (scrollTop + viewport) / total;
    if (ratio >= threshold) {
      fired = true;
      opts.onReached();
    }
  };

  const onScroll = () => {
    userScrolled = true;
    if (timeoutId) return;
    timeoutId = setTimeout(() => {
      timeoutId = null;
      check();
    }, 200);
  };

  const attachListeners = () => {
    if (target.isWindow) {
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
    } else if (target.element) {
      target.element.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
    } else {
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
    }
  };

  const detachListeners = () => {
    if (target.element) target.element.removeEventListener('scroll', onScroll);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };

  attachListeners();

  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  if (!target.isWindow && !target.element) {
    retryTimer = setTimeout(() => {
      retryTimer = null;
      const previous = target;
      resolveTarget();
      if (target.element !== previous.element || target.isWindow !== previous.isWindow) {
        detachListeners();
        attachListeners();
      }
    }, 2_000);
  }

  return {
    cleanup() {
      detachListeners();
      window.removeEventListener('load', onLoad);
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    },
  };
}
