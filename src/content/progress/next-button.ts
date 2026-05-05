interface NextButtonOptions {
  selector: string;
  onClicked: () => void;
}

export interface NextButtonObserver {
  cleanup: () => void;
}

export function createNextButtonObserver(opts: NextButtonOptions): NextButtonObserver {
  let fired = false;

  const handler = (event: Event) => {
    if (fired) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const match = target.closest(opts.selector);
    if (!match) return;
    fired = true;
    opts.onClicked();
  };

  document.addEventListener('click', handler, { capture: true });
  document.addEventListener('pointerdown', handler, { capture: true });

  return {
    cleanup() {
      document.removeEventListener('click', handler, { capture: true });
      document.removeEventListener('pointerdown', handler, { capture: true });
    },
  };
}
