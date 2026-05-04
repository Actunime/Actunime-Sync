/**
 * Wizard de configuration d'un site (E17).
 *
 * Flow :
 *   1. Welcome — l'user doit être sur une page d'épisode, valide pour analyser
 *   2. Results — 4 stratégies tournées en parallèle, l'user choisit la bonne
 *   3. Manual — pick visuel : highlight au survol + clic capture le sélecteur
 *      CSS du titre puis du numéro d'épisode (saison optionnelle)
 *   4. Confirm — récap final, sauvegarde le LearnedPattern dans `chrome.storage.local`
 *
 * Sortie : `Promise<LearnedPattern | null>` (null = user a annulé).
 */

import type {
  LearnedPattern,
  MangaTrackingConfig,
  MangaTrackingMode,
  NumericSelector,
  StrategyId,
} from '@/shared/types';
import type { StrategyResult } from '@/shared/messaging';
import { sendMessage } from '@/shared/messaging';
import { parseLearnedPatternsExport } from '@/shared/learned-patterns-io';
import { runAllStrategies, deriveEpisodeUrlRegex } from './strategies';

const WIZARD_ID = 'actunime-config-wizard';
const PICK_OVERLAY_ID = 'actunime-config-wizard-pick';
const FONT_STACK =
  "'Outfit Variable', 'Outfit', system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

type PickField = 'title' | 'episode' | 'season';

interface ManualSelection {
  title?: string;
  titleText?: string;
  episode?: string;
  episodeTokenIndex?: number;
  /** Texte intégral de l'élément pointé (pour rappel à l'user dans confirm). */
  episodeText?: string;
  season?: string;
  seasonTokenIndex?: number;
  seasonText?: string;
}

/**
 * Quand l'user a pointé un élément numérique mais que son textContent
 * contient plusieurs nombres, on lui demande lequel est le bon.
 */
interface PendingTokenChoice {
  field: 'episode' | 'season';
  selector: string;
  rawText: string;
  /** Nombres extraits par /\d+/g, dans l'ordre. */
  tokens: string[];
}

interface WizardState {
  step: 'welcome' | 'results' | 'manual' | 'manual-token' | 'tracking-manga' | 'confirm';
  kind: 'anime' | 'manga';
  results: StrategyResult[];
  chosenStrategy?: StrategyId;
  manual: ManualSelection;
  pendingToken?: PendingTokenChoice;
  mangaTracking?: MangaTrackingConfig;
}

/**
 * Lance le wizard. Renvoie le pattern sauvegardé ou `null` si l'user annule.
 */
export async function launchConfigWizard(opts: { kind: 'anime' | 'manga' }): Promise<LearnedPattern | null> {
  removeExisting();
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = WIZARD_ID;
    host.style.cssText = `position:fixed;inset:0;z-index:2147483647;font-family:${FONT_STACK};display:flex;align-items:center;justify-content:center;`;
    const shadow = host.attachShadow({ mode: 'closed' });

    const state: WizardState = {
      step: 'welcome',
      kind: opts.kind,
      results: [],
      manual: {},
      mangaTracking: opts.kind === 'manga' ? { mode: 'manual' } : undefined,
    };

    let resolved = false;
    const finish = (pattern: LearnedPattern | null) => {
      if (resolved) return;
      resolved = true;
      cleanupPick();
      removeExisting();
      resolve(pattern);
    };

    shadow.innerHTML = renderShell();
    document.documentElement.appendChild(host);

    const updateKindToggle = () => {
      shadow.querySelectorAll<HTMLButtonElement>('.kind-toggle button').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.kind === state.kind);
      });
    };
    updateKindToggle();
    shadow.querySelectorAll<HTMLButtonElement>('.kind-toggle button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.kind as 'anime' | 'manga' | undefined;
        if (!next || next === state.kind) return;
        state.kind = next;
        if (next === 'manga' && !state.mangaTracking) {
          state.mangaTracking = { mode: 'manual' };
        } else if (next === 'anime') {
          state.mangaTracking = undefined;
        }
        updateKindToggle();
      });
    });

    const render = () => {
      const root = shadow.querySelector('#wiz-content');
      if (!root) return;
      switch (state.step) {
        case 'welcome':
          root.innerHTML = renderWelcome(state.kind);
          wireWelcome();
          break;
        case 'results':
          root.innerHTML = renderResults(state.results, state.kind);
          wireResults();
          break;
        case 'manual':
          root.innerHTML = renderManual(state.manual, state.kind);
          wireManual();
          break;
        case 'manual-token':
          if (state.pendingToken) {
            root.innerHTML = renderTokenChoice(state.pendingToken, state.kind);
            wireTokenChoice();
          }
          break;
        case 'tracking-manga':
          root.innerHTML = renderTrackingManga(state);
          wireTrackingManga();
          break;
        case 'confirm':
          root.innerHTML = renderConfirm(state);
          wireConfirm();
          break;
      }
    };

    // ─────────── helpers wiring ────────────

    const wireWelcome = () => {
      shadow.querySelector('#wiz-analyze')?.addEventListener('click', () => {
        state.results = runAllStrategies();
        state.step = 'results';
        render();
      });
      shadow.querySelector('#wiz-import')?.addEventListener('click', () => {
        const input = shadow.querySelector<HTMLInputElement>('#wiz-import-file');
        input?.click();
      });
      shadow.querySelector<HTMLInputElement>('#wiz-import-file')?.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        await handleImportFile(file, opts.kind, finish, shadow);
        (e.target as HTMLInputElement).value = '';
      });
      shadow.querySelector('#wiz-cancel')?.addEventListener('click', () => finish(null));
    };

    const wireResults = () => {
      shadow.querySelectorAll<HTMLElement>('[data-strategy-id]').forEach((el) => {
        el.addEventListener('click', () => {
          if (el.dataset.disabled === '1') return;
          const id = el.dataset.strategyId as StrategyId;
          state.chosenStrategy = id;
          shadow
            .querySelectorAll('[data-strategy-id]')
            .forEach((c) => c.classList.remove('selected'));
          el.classList.add('selected');
          const confirm = shadow.querySelector<HTMLButtonElement>('#wiz-confirm-strategy');
          // Validation : la stratégie doit avoir trouvé titre + épisode pour
          // être actionnable (la saison reste optionnelle).
          const r = state.results.find((x) => x.id === id);
          if (confirm) confirm.disabled = !(r?.title && r.episode !== undefined);
        });
      });
      shadow.querySelector('#wiz-confirm-strategy')?.addEventListener('click', () => {
        if (!state.chosenStrategy) return;
        state.step = state.kind === 'manga' ? 'tracking-manga' : 'confirm';
        render();
      });
      shadow.querySelector('#wiz-go-manual')?.addEventListener('click', () => {
        state.chosenStrategy = 'manual';
        state.manual = {};
        state.step = 'manual';
        render();
      });
      shadow.querySelector('#wiz-back-welcome')?.addEventListener('click', () => {
        state.step = 'welcome';
        render();
      });
      shadow.querySelector('#wiz-cancel')?.addEventListener('click', () => finish(null));
    };

    const wireManual = () => {
      shadow.querySelectorAll<HTMLElement>('[data-pick-field]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const field = btn.dataset.pickField as PickField;
          startPick(field, host, shadow, state, render);
        });
      });
      shadow.querySelectorAll<HTMLElement>('[data-clear-field]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const field = btn.dataset.clearField as PickField;
          if (field === 'title') {
            state.manual.title = undefined;
            state.manual.titleText = undefined;
          } else if (field === 'episode') {
            state.manual.episode = undefined;
            state.manual.episodeTokenIndex = undefined;
            state.manual.episodeText = undefined;
          } else if (field === 'season') {
            state.manual.season = undefined;
            state.manual.seasonTokenIndex = undefined;
            state.manual.seasonText = undefined;
          }
          render();
        });
      });
      shadow.querySelector('#wiz-manual-validate')?.addEventListener('click', () => {
        if (!state.manual.title || !state.manual.episode) return;
        state.step = state.kind === 'manga' ? 'tracking-manga' : 'confirm';
        render();
      });
      shadow.querySelector('#wiz-back-results')?.addEventListener('click', () => {
        state.step = 'results';
        render();
      });
      shadow.querySelector('#wiz-cancel')?.addEventListener('click', () => finish(null));
    };

    const wireTokenChoice = () => {
      shadow.querySelectorAll<HTMLElement>('[data-token-index]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!state.pendingToken) return;
          const idx = Number(btn.dataset.tokenIndex);
          const { field, selector, rawText, tokens } = state.pendingToken;
          const chosen = tokens[idx];
          if (field === 'episode') {
            state.manual.episode = selector;
            state.manual.episodeTokenIndex = idx;
            state.manual.episodeText = `${rawText} → ${chosen}`;
          } else {
            state.manual.season = selector;
            state.manual.seasonTokenIndex = idx;
            state.manual.seasonText = `${rawText} → ${chosen}`;
          }
          state.pendingToken = undefined;
          state.step = 'manual';
          render();
        });
      });
      shadow.querySelector('#wiz-token-cancel')?.addEventListener('click', () => {
        state.pendingToken = undefined;
        state.step = 'manual';
        render();
      });
    };

    const wireTrackingManga = () => {
      const setMode = (mode: MangaTrackingMode) => {
        if (mode === 'scroll') {
          state.mangaTracking = { mode, threshold: 0.9 };
        } else if (mode === 'manual') {
          state.mangaTracking = { mode };
        } else {
          const existing =
            state.mangaTracking?.mode === mode ? state.mangaTracking : undefined;
          state.mangaTracking = { mode, selector: existing?.selector };
        }
        render();
      };

      shadow.querySelectorAll<HTMLElement>('[data-tracking-mode]').forEach((el) => {
        el.addEventListener('click', () => {
          const mode = el.dataset.trackingMode as MangaTrackingMode;
          setMode(mode);
        });
      });

      shadow.querySelector('#wiz-pick-counter')?.addEventListener('click', () => {
        startSimplePick(
          'Cliquez sur le compteur de page (ex. « 12 / 24 »).',
          host,
          (selector) => {
            state.mangaTracking = { mode: 'page-counter', selector };
            render();
          },
          () => render(),
        );
      });

      shadow.querySelector('#wiz-pick-scroll-container')?.addEventListener('click', () => {
        startSimplePick(
          'Cliquez sur la zone qui scrolle (le conteneur du lecteur).',
          host,
          (selector) => {
            state.mangaTracking = { mode: 'scroll', threshold: 0.9, selector };
            render();
          },
          () => render(),
        );
      });
      shadow.querySelector('#wiz-clear-scroll-container')?.addEventListener('click', () => {
        state.mangaTracking = { mode: 'scroll', threshold: 0.9 };
        render();
      });

      shadow.querySelector('#wiz-pick-next')?.addEventListener('click', () => {
        startSimplePick(
          'Cliquez sur le bouton « chapitre suivant ».',
          host,
          (selector) => {
            state.mangaTracking = { mode: 'next-button', selector };
            render();
          },
          () => render(),
        );
      });

      shadow.querySelector('#wiz-tracking-back')?.addEventListener('click', () => {
        state.step = state.chosenStrategy === 'manual' ? 'manual' : 'results';
        render();
      });
      shadow.querySelector('#wiz-tracking-next')?.addEventListener('click', () => {
        if (!state.mangaTracking) state.mangaTracking = { mode: 'manual' };
        const m = state.mangaTracking;
        if ((m.mode === 'page-counter' || m.mode === 'next-button') && !m.selector) return;
        state.step = 'confirm';
        render();
      });
      shadow.querySelector('#wiz-cancel')?.addEventListener('click', () => finish(null));
    };

    const wireConfirm = () => {
      shadow.querySelector('#wiz-save')?.addEventListener('click', async () => {
        const btn = shadow.querySelector<HTMLButtonElement>('#wiz-save');
        if (btn) {
          btn.disabled = true;
          btn.textContent = '…';
        }
        const pattern = buildPattern(state, state.kind);
        const res = (await sendMessage({
          type: 'SAVE_LEARNED_PATTERN',
          payload: { pattern },
        })) as { ok: boolean; error?: string };
        if (!res.ok) {
          const status = shadow.querySelector('#wiz-save-status');
          if (status) status.textContent = res.error ?? 'Erreur de sauvegarde.';
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Sauvegarder';
          }
          return;
        }
        finish(pattern);
      });
      shadow.querySelector('#wiz-back')?.addEventListener('click', () => {
        if (state.kind === 'manga') {
          state.step = 'tracking-manga';
        } else {
          state.step = state.chosenStrategy === 'manual' ? 'manual' : 'results';
        }
        render();
      });
      shadow.querySelector('#wiz-cancel')?.addEventListener('click', () => finish(null));
    };

    render();

    // Esc global pour fermer
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state.step !== 'manual') {
        finish(null);
      }
    };
    document.addEventListener('keydown', onKey);
    const origFinish = finish;
    // patch finish to remove listener
    const wrapped = (p: LearnedPattern | null) => {
      document.removeEventListener('keydown', onKey);
      origFinish(p);
    };
    // overwrite finish via closure isn't possible — but we listen + finish removes overlay,
    // and the listener is attached to document; once shadow disappears we just clean here:
    void wrapped;
  });
}

function removeExisting() {
  document.getElementById(WIZARD_ID)?.remove();
  document.getElementById(PICK_OVERLAY_ID)?.remove();
}

function buildPattern(state: WizardState, kind: 'anime' | 'manga'): LearnedPattern {
  const now = new Date().toISOString();
  const host = location.hostname;
  const episodeUrlRegex = deriveEpisodeUrlRegex(location.pathname);
  const mangaTracking = kind === 'manga' ? state.mangaTracking : undefined;

  if (state.chosenStrategy === 'manual') {
    const episode: NumericSelector | undefined = state.manual.episode
      ? { selector: state.manual.episode, tokenIndex: state.manual.episodeTokenIndex }
      : undefined;
    const season: NumericSelector | undefined = state.manual.season
      ? { selector: state.manual.season, tokenIndex: state.manual.seasonTokenIndex }
      : undefined;
    return {
      host,
      kind,
      strategy: 'manual',
      manualSelectors: state.manual.title
        ? { title: state.manual.title, episode, season }
        : undefined,
      episodeUrlRegex,
      mangaTracking,
      createdAt: now,
      updatedAt: now,
    };
  }
  return {
    host,
    kind,
    strategy: (state.chosenStrategy ?? 'jsonld') as StrategyId,
    episodeUrlRegex,
    mangaTracking,
    createdAt: now,
    updatedAt: now,
  };
}

// ─────────────────────────── Pick visuel ────────────────────────────

interface PickContext {
  field: PickField;
  highlightEl: HTMLElement;
  toolbarEl: HTMLElement;
  onMove: (e: MouseEvent) => void;
  onClick: (e: MouseEvent) => void;
  onKey: (e: KeyboardEvent) => void;
  prevPointerEvents: string;
}
let pickCtx: PickContext | null = null;

function startPick(
  field: PickField,
  wizardHost: HTMLElement,
  _shadow: ShadowRoot,
  state: WizardState,
  render: () => void,
): void {
  cleanupPick();
  // Cache le wizard pendant le pick (l'user doit voir la page)
  wizardHost.style.display = 'none';

  const isManga = state.kind === 'manga';
  const fieldLabel =
    field === 'title'
      ? 'le titre'
      : field === 'episode'
        ? isManga
          ? 'le numéro de chapitre'
          : "le numéro d'épisode"
        : 'le numéro de saison';

  const highlight = document.createElement('div');
  highlight.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483646;
    border: 2px solid oklch(66.906% 0.18376 248.826);
    background: oklch(66.906% 0.18376 248.826 / 0.15);
    border-radius: 3px;
    transition: all 50ms ease-out;
  `;
  highlight.id = PICK_OVERLAY_ID;
  document.documentElement.appendChild(highlight);

  const toolbar = document.createElement('div');
  toolbar.id = PICK_OVERLAY_ID + '-toolbar';
  toolbar.style.cssText = `
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    z-index: 2147483647;
    background: #030a1d;
    color: #fafafa;
    border: 1px solid rgba(60, 90, 166, 0.4);
    border-radius: 8px;
    padding: 10px 14px;
    font-family: ${FONT_STACK};
    font-size: 13px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
    display: flex; align-items: center; gap: 12px;
    pointer-events: auto;
  `;
  toolbar.innerHTML = `
    <span style="font-size: 11px; padding: 2px 8px; background: oklch(66.906% 0.18376 248.826); color: #030a1d; border-radius: 4px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;">Sélection</span>
    <span>Cliquez sur <strong style="color: oklch(66.906% 0.18376 248.826);">${fieldLabel}</strong> dans la page.</span>
    <button id="wiz-pick-cancel" style="margin-left: 8px; padding: 4px 10px; background: rgba(255, 255, 255, 0.06); color: #fafafa; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 4px; font-size: 11px; cursor: pointer; font-family: ${FONT_STACK};">Annuler (Esc)</button>
  `;
  document.documentElement.appendChild(toolbar);

  const cancelBtn = toolbar.querySelector<HTMLButtonElement>('#wiz-pick-cancel');
  cancelBtn?.addEventListener('click', () => {
    cleanupPick();
    wizardHost.style.display = 'flex';
    render();
  });

  const onMove = (e: MouseEvent) => {
    const target = elementFromPointSkipOverlay(e.clientX, e.clientY);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  };

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    const target = elementFromPointSkipOverlay(e.clientX, e.clientY);
    if (!target) return;
    const selector = generateSelector(target);
    const fullText = target.textContent?.trim() ?? '';
    const text = fullText.slice(0, 200);

    cleanupPick();
    wizardHost.style.display = 'flex';

    if (field === 'title') {
      state.manual.title = selector;
      state.manual.titleText = text;
      render();
      return;
    }

    // Champs numériques : on regarde combien de nombres sont dans le textContent.
    // S'il y en a plusieurs, on demande à l'user de pointer le bon.
    const tokens = fullText.match(/\d{1,4}/g) ?? [];
    if (tokens.length === 0) {
      // Aucun nombre — on stocke quand même le sélecteur, le runtime tentera
      // un parse heuristique (regex sur préfixes). Edge case sur certains DOM
      // où le nombre arrive en async.
      if (field === 'episode') {
        state.manual.episode = selector;
        state.manual.episodeTokenIndex = undefined;
        state.manual.episodeText = text || '(vide)';
      } else {
        state.manual.season = selector;
        state.manual.seasonTokenIndex = undefined;
        state.manual.seasonText = text || '(vide)';
      }
      render();
      return;
    }
    if (tokens.length === 1) {
      // Un seul nombre : pas d'ambiguïté, on stocke directement.
      if (field === 'episode') {
        state.manual.episode = selector;
        state.manual.episodeTokenIndex = 0;
        state.manual.episodeText = text;
      } else {
        state.manual.season = selector;
        state.manual.seasonTokenIndex = 0;
        state.manual.seasonText = text;
      }
      render();
      return;
    }
    // Plusieurs nombres : demander lequel.
    state.pendingToken = {
      field: field as 'episode' | 'season',
      selector,
      rawText: text,
      tokens,
    };
    state.step = 'manual-token';
    render();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanupPick();
      wizardHost.style.display = 'flex';
      render();
    }
  };

  // Capture phase pour passer devant les listeners du site
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);

  pickCtx = {
    field,
    highlightEl: highlight,
    toolbarEl: toolbar,
    onMove,
    onClick,
    onKey,
    prevPointerEvents: '',
  };
}

function cleanupPick() {
  if (!pickCtx) return;
  document.removeEventListener('mousemove', pickCtx.onMove, true);
  document.removeEventListener('click', pickCtx.onClick, true);
  document.removeEventListener('keydown', pickCtx.onKey, true);
  pickCtx.highlightEl.remove();
  pickCtx.toolbarEl.remove();
  pickCtx = null;
}

function startSimplePick(
  prompt: string,
  wizardHost: HTMLElement,
  onPicked: (selector: string, text: string) => void,
  onCancel: () => void,
): void {
  cleanupPick();
  wizardHost.style.display = 'none';

  const highlight = document.createElement('div');
  highlight.id = PICK_OVERLAY_ID;
  highlight.style.cssText = `position:fixed;pointer-events:none;z-index:2147483646;border:2px solid oklch(66.906% 0.18376 248.826);background:oklch(66.906% 0.18376 248.826/0.15);border-radius:3px;transition:all 50ms ease-out;`;
  document.documentElement.appendChild(highlight);

  const toolbar = document.createElement('div');
  toolbar.id = PICK_OVERLAY_ID + '-toolbar';
  toolbar.style.cssText = `position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#030a1d;color:#fafafa;border:1px solid rgba(60,90,166,0.4);border-radius:8px;padding:10px 14px;font-family:${FONT_STACK};font-size:13px;box-shadow:0 12px 32px rgba(0,0,0,0.6);display:flex;align-items:center;gap:12px;`;
  toolbar.innerHTML = `
    <span style="font-size:11px;padding:2px 8px;background:oklch(66.906% 0.18376 248.826);color:#030a1d;border-radius:4px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Sélection</span>
    <span>${escapeHtml(prompt)}</span>
    <button id="wiz-simple-pick-cancel" style="margin-left:8px;padding:4px 10px;background:rgba(255,255,255,0.06);color:#fafafa;border:1px solid rgba(255,255,255,0.12);border-radius:4px;font-size:11px;cursor:pointer;font-family:${FONT_STACK};">Annuler (Esc)</button>
  `;
  document.documentElement.appendChild(toolbar);

  const restore = () => {
    cleanupPick();
    wizardHost.style.display = 'flex';
  };

  toolbar.querySelector<HTMLButtonElement>('#wiz-simple-pick-cancel')?.addEventListener('click', () => {
    restore();
    onCancel();
  });

  const onMove = (e: MouseEvent) => {
    const target = elementFromPointSkipOverlay(e.clientX, e.clientY);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  };

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    const target = elementFromPointSkipOverlay(e.clientX, e.clientY);
    if (!target) return;
    const selector = generateSelector(target);
    const text = (target.textContent?.trim() ?? '').slice(0, 200);
    restore();
    onPicked(selector, text);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      restore();
      onCancel();
    }
  };

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);

  pickCtx = {
    field: 'title',
    highlightEl: highlight,
    toolbarEl: toolbar,
    onMove,
    onClick,
    onKey,
    prevPointerEvents: '',
  };
}

/**
 * `document.elementFromPoint` peut tomber sur le highlight overlay lui-même —
 * on l'ignore pour ne renvoyer que des éléments « réels » de la page.
 */
function elementFromPointSkipOverlay(x: number, y: number): HTMLElement | null {
  // Le highlight est en `pointer-events: none` donc skip auto. Mais on garde
  // ce helper si on voulait gérer plusieurs overlays.
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  if (el.id === PICK_OVERLAY_ID || el.id === WIZARD_ID) return null;
  if (el instanceof HTMLElement) return el;
  return null;
}

/**
 * Génère un sélecteur CSS court et raisonnablement stable pour un élément :
 *   - id si dispo et unique
 *   - data-testid > data-test > aria-label
 *   - tag.classe1.classe2 si unique
 *   - sinon, chemin parent > enfant avec :nth-of-type
 *
 * Garantie : on vérifie que le sélecteur retourne bien l'élément avant de le
 * renvoyer. Sinon on retombe sur un chemin nth-of-type complet.
 */
export function generateSelector(el: HTMLElement): string {
  // 1. ID — privilégié si stable et unique (pas auto-généré react-id)
  const id = el.id;
  if (id && /^[a-zA-Z][\w-]{0,40}$/.test(id) && document.querySelectorAll(`#${cssEscape(id)}`).length === 1) {
    return `#${cssEscape(id)}`;
  }

  // 2. Attributs testid (très stables côté front moderne)
  const testid =
    el.getAttribute('data-testid') ??
    el.getAttribute('data-test-id') ??
    el.getAttribute('data-test');
  if (testid) {
    const sel = `[data-testid="${cssEscape(testid)}"]`;
    if (document.querySelectorAll(sel).length === 1) return sel;
  }

  // 3. Classes stables (filtre les classes hashées genre css-3rg5xn)
  const classSel = buildClassSelector(el);
  if (classSel && document.querySelectorAll(classSel).length === 1) return classSel;

  // 4. Path montant avec nth-of-type
  return buildPathSelector(el);
}

function buildClassSelector(el: HTMLElement): string | null {
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).filter(
    (c) => /^[a-zA-Z_-][\w-]{1,40}$/.test(c) && !/^css-[a-z0-9]{4,}$/.test(c) && !/^_/.test(c),
  );
  if (classes.length === 0) return null;
  return tag + '.' + classes.map(cssEscape).join('.');
}

function buildPathSelector(el: HTMLElement): string {
  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.documentElement && parts.length < 6) {
    const node: HTMLElement = cur;
    const tag = node.tagName.toLowerCase();
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const siblings = Array.from(parent.children).filter(
      (s): s is Element => s.tagName === node.tagName,
    );
    if (siblings.length === 1) {
      parts.unshift(tag);
    } else {
      const idx = siblings.indexOf(node) + 1;
      parts.unshift(`${tag}:nth-of-type(${idx})`);
    }
    // Si le parent a un ID stable on s'arrête là
    if (parent.id && /^[a-zA-Z][\w-]{0,40}$/.test(parent.id)) {
      parts.unshift(`#${cssEscape(parent.id)}`);
      return parts.join(' > ');
    }
    cur = parent;
  }
  return parts.join(' > ');
}

function cssEscape(s: string): string {
  return s.replace(/(["\\\.\#\[\]\:\(\)\s])/g, '\\$1');
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─────────────────────────── Rendering ──────────────────────────────

function renderShell(): string {
  return `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .backdrop {
        position: fixed; inset: 0;
        background: rgba(3, 10, 29, 0.65);
        backdrop-filter: blur(2px);
        display: flex; align-items: center; justify-content: center;
        padding: 24px;
        font-family: ${FONT_STACK};
        animation: fadeIn 200ms ease-out;
      }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes slideIn { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

      .card {
        width: 560px; max-width: 100%; max-height: 90vh;
        display: flex; flex-direction: column;
        background: #030a1d;
        color: oklch(0.985 0.002 247.839);
        border: 1px solid rgba(60, 90, 166, 0.3);
        border-radius: 12px;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(60, 90, 166, 0.15);
        font-size: 13px; line-height: 1.5;
        overflow: hidden;
        animation: slideIn 280ms cubic-bezier(0.2, 0.9, 0.3, 1);
      }
      .header {
        padding: 16px 20px;
        background: linear-gradient(180deg, #0c1945 0%, #030a1d 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        display: flex; align-items: center; gap: 10px;
      }
      .header .badge {
        padding: 3px 9px; border-radius: 4px;
        background: oklch(66.906% 0.18376 248.826); color: #030a1d;
        font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
      }
      .header h2 { margin: 0; font-size: 15px; font-weight: 600; flex: 1; }
      .kind-toggle {
        display: flex;
        gap: 0;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        padding: 2px;
      }
      .kind-toggle button {
        background: transparent;
        border: none;
        color: oklch(86.989% 0.06369 262.465);
        cursor: pointer;
        font-size: 11px;
        font-weight: 500;
        padding: 4px 10px;
        border-radius: 4px;
        font-family: ${FONT_STACK};
        transition: background 120ms, color 120ms;
      }
      .kind-toggle button.active {
        background: oklch(66.906% 0.18376 248.826);
        color: #030a1d;
        font-weight: 600;
      }
      .kind-toggle button:not(.active):hover { color: oklch(0.985 0.002 247.839); }
      .header .close {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        color: oklch(86.989% 0.06369 262.465);
        cursor: pointer; font-size: 18px; line-height: 1;
        width: 28px; height: 28px; border-radius: 6px;
        display: flex; align-items: center; justify-content: center;
        transition: background 120ms;
      }
      .header .close:hover { background: rgba(255, 255, 255, 0.08); }

      .body { padding: 18px 20px; overflow-y: auto; flex: 1; }
      .body::-webkit-scrollbar { width: 8px; }
      .body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 4px; }

      h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
      p { margin: 0 0 12px; color: oklch(86.989% 0.06369 262.465); }
      .muted { color: oklch(86.989% 0.06369 262.465); }
      .small { font-size: 11px; }

      .strategy-list { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
      .strategy {
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 8px;
        padding: 12px;
        cursor: pointer;
        transition: border-color 120ms, background 120ms;
      }
      .strategy:hover {
        border-color: rgba(60, 90, 166, 0.3);
        background: rgba(60, 90, 166, 0.06);
      }
      .strategy.selected {
        border-color: oklch(66.906% 0.18376 248.826);
        background: rgba(60, 90, 166, 0.16);
      }
      .strategy.empty {
        opacity: 0.55; cursor: not-allowed;
      }
      .strategy.empty:hover { border-color: rgba(255, 255, 255, 0.06); background: transparent; }
      .strategy-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px; }
      .strategy-label { font-weight: 600; font-size: 13px; }
      .conf { font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 600; flex-shrink: 0; }
      .conf.high { background: oklch(34% 0.13 145); color: oklch(85% 0.18 145); }
      .conf.med { background: oklch(34% 0.13 80); color: oklch(85% 0.18 80); }
      .conf.low { background: rgba(248, 113, 113, 0.15); color: oklch(0.704 0.191 22.216); }
      .conf.empty { background: rgba(255, 255, 255, 0.04); color: oklch(86.989% 0.06369 262.465); }
      .strategy-desc { font-size: 11px; color: oklch(86.989% 0.06369 262.465); margin-bottom: 10px; }
      .extracted {
        display: grid; grid-template-columns: 80px 1fr; gap: 4px 10px;
        font-size: 12px;
        padding: 8px 10px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 6px;
        margin-top: 6px;
      }
      .extracted .key { color: oklch(86.989% 0.06369 262.465); font-size: 11px; }
      .extracted .val { color: oklch(0.985 0.002 247.839); font-weight: 500; word-break: break-word; }
      .extracted .val.missing { color: oklch(86.989% 0.06369 262.465); font-weight: 400; font-style: italic; opacity: 0.6; }
      .evidence {
        margin-top: 8px;
        font-size: 10px;
        font-family: ui-monospace, 'JetBrains Mono', 'Fira Code', Menlo, monospace;
        white-space: pre-wrap;
        max-height: 80px; overflow-y: auto;
        padding: 6px 8px;
        background: rgba(0, 0, 0, 0.4);
        border-radius: 4px;
        color: oklch(80% 0.05 250);
        border: 1px solid rgba(255, 255, 255, 0.04);
      }

      .field {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        margin-bottom: 8px;
      }
      .field-label { width: 90px; font-weight: 500; font-size: 12px; flex-shrink: 0; }
      .field-value { flex: 1; min-width: 0; }
      .field-value .text {
        font-size: 12px; color: oklch(0.985 0.002 247.839);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .field-value .selector {
        font-family: ui-monospace, monospace;
        font-size: 10px;
        color: oklch(86.989% 0.06369 262.465);
        margin-top: 2px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .field-value.empty .text { color: oklch(86.989% 0.06369 262.465); font-style: italic; }
      .field-actions { display: flex; gap: 4px; flex-shrink: 0; }

      .btn {
        padding: 7px 12px;
        border-radius: 6px;
        font-size: 12px; font-weight: 500;
        cursor: pointer;
        font-family: ${FONT_STACK};
        transition: background 120ms, border-color 120ms;
        white-space: nowrap;
      }
      .btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .btn.primary {
        background: oklch(66.906% 0.18376 248.826);
        color: #030a1d;
        border: 1px solid oklch(66.906% 0.18376 248.826);
        font-weight: 600;
      }
      .btn.primary:not(:disabled):hover { background: oklch(72% 0.18 248.826); }
      .btn.secondary {
        background: rgba(255, 255, 255, 0.04);
        color: oklch(0.985 0.002 247.839);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .btn.secondary:not(:disabled):hover { background: rgba(255, 255, 255, 0.08); }
      .btn.ghost {
        background: transparent;
        color: oklch(86.989% 0.06369 262.465);
        border: 1px solid transparent;
      }
      .btn.ghost:hover { background: rgba(255, 255, 255, 0.04); color: #fff; }
      .btn.small { padding: 4px 8px; font-size: 11px; }

      .footer {
        padding: 12px 20px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(0, 0, 0, 0.2);
        display: flex; justify-content: space-between; gap: 8px;
        flex-wrap: wrap;
      }
      .footer .right { display: flex; gap: 8px; flex-wrap: wrap; }

      .pill {
        display: inline-block;
        padding: 2px 8px;
        font-size: 10px;
        background: rgba(60, 90, 166, 0.2);
        border: 1px solid rgba(60, 90, 166, 0.35);
        border-radius: 10px;
        color: oklch(86.989% 0.06369 262.465);
      }
      .save-status {
        font-size: 11px; color: oklch(0.704 0.191 22.216);
        margin-top: 4px;
        min-height: 14px;
      }
    </style>
    <div class="backdrop">
      <div class="card">
        <div class="header">
          <span class="badge">Actunime</span>
          <h2>Configurer la détection sur ce site</h2>
          <div class="kind-toggle" role="tablist" aria-label="Type de contenu">
            <button type="button" data-kind="anime" id="wiz-kind-anime" role="tab">Anime</button>
            <button type="button" data-kind="manga" id="wiz-kind-manga" role="tab">Manga</button>
          </div>
          <button class="close" id="wiz-cancel" aria-label="Fermer">×</button>
        </div>
        <div class="body" id="wiz-content"></div>
      </div>
    </div>
  `;
}

function renderWelcome(kind: 'anime' | 'manga'): string {
  const isManga = kind === 'manga';
  const pageWord = isManga ? 'chapitre' : 'épisode';
  const numberWord = isManga ? 'numéro de chapitre' : "numéro d'épisode";
  return `
    <h3>Pour bien configurer ce site…</h3>
    <p>Ouvre une page de ${pageWord} (pas la home, pas la fiche série) puis clique <strong>Analyser cette page</strong>.
    L'extension va tester 4 stratégies pour trouver le titre et le ${numberWord} automatiquement.</p>
    <p class="small muted">Si aucune ne marche, tu pourras configurer manuellement en pointant les éléments du DOM. Tu peux aussi importer un pattern partagé par un autre utilisateur.</p>
    <div id="wiz-import-status" class="save-status"></div>
    <input type="file" id="wiz-import-file" accept=".json,application/json" style="display:none" />
    <div class="footer" style="margin: 12px -20px 0; border-top: none; background: transparent; padding: 12px 20px; flex-wrap: wrap;">
      <span class="pill">${escapeHtml(location.hostname)}</span>
      <div class="right">
        <button class="btn ghost" id="wiz-import">Importer un pattern</button>
        <button class="btn primary" id="wiz-analyze">Analyser cette page</button>
      </div>
    </div>
  `;
}

async function handleImportFile(
  file: File,
  kind: 'anime' | 'manga',
  finish: (pattern: LearnedPattern | null) => void,
  shadow: ShadowRoot,
): Promise<void> {
  const status = shadow.querySelector('#wiz-import-status');
  const showError = (msg: string) => {
    if (status) status.textContent = msg;
  };

  let text: string;
  try {
    text = await file.text();
  } catch {
    showError('Impossible de lire le fichier.');
    return;
  }

  const parsed = parseLearnedPatternsExport(text);
  if (!parsed.ok) {
    showError(parsed.error);
    return;
  }

  const matching = parsed.patterns.find((p) => p.host === location.hostname);
  if (!matching) {
    const hosts = parsed.patterns.map((p) => p.host).join(', ');
    showError(
      `Le fichier ne contient pas de pattern pour ${location.hostname}. Hosts trouvés : ${hosts}`,
    );
    return;
  }

  // Force le kind du wizard sur le pattern importé (l'export est neutre).
  const toSave: LearnedPattern = {
    ...matching,
    kind,
    updatedAt: new Date().toISOString(),
  };
  const res = (await sendMessage({
    type: 'SAVE_LEARNED_PATTERN',
    payload: { pattern: toSave },
  })) as { ok: boolean; error?: string };
  if (!res.ok) {
    showError(res.error ?? 'Erreur de sauvegarde.');
    return;
  }
  finish(toSave);
}

function confidenceClass(c: number): string {
  if (c === 0) return 'empty';
  if (c >= 0.65) return 'high';
  if (c >= 0.4) return 'med';
  return 'low';
}

function confidenceLabel(c: number): string {
  if (c === 0) return 'aucune';
  if (c >= 0.65) return 'élevée';
  if (c >= 0.4) return 'moyenne';
  return 'faible';
}

function renderResults(results: StrategyResult[], kind: 'anime' | 'manga'): string {
  const isManga = kind === 'manga';
  const numberWord = isManga ? 'Chapitre' : 'Épisode';
  const numberWordLow = isManga ? 'chapitre' : 'épisode';
  const numberMissingMsg = isManga ? 'Numéro de chapitre manquant' : "Numéro d'épisode manquant";

  const list = results
    .map((r) => {
      const usable = !!(r.title && r.episode !== undefined);
      const cls = confidenceClass(r.confidence);
      const label = confidenceLabel(r.confidence);
      const titleVal = r.title
        ? `<span class="val">${escapeHtml(r.title)}</span>`
        : `<span class="val missing">non trouvé</span>`;
      const epVal = r.episode !== undefined
        ? `<span class="val">${escapeHtml(r.episode)}</span>`
        : `<span class="val missing">non trouvé</span>`;
      const seasonVal = r.season !== undefined
        ? `<span class="val">${escapeHtml(r.season)}</span>`
        : `<span class="val missing">— (optionnel)</span>`;
      const evidence = r.evidence
        ? `<div class="evidence">${escapeHtml(r.evidence)}</div>`
        : '';

      const reasonHtml = usable
        ? ''
        : `<div class="strategy-blocked">⊘ ${escapeHtml(
            r.title ? numberMissingMsg : 'Titre manquant',
          )} — stratégie inutilisable</div>`;

      return `
        <div class="strategy ${usable ? '' : 'empty'}" data-strategy-id="${escapeHtml(r.id)}" ${usable ? '' : 'data-disabled="1"'}>
          <div class="strategy-header">
            <div>
              <div class="strategy-label">${escapeHtml(r.label)}</div>
              <div class="strategy-desc">${escapeHtml(r.description)}</div>
            </div>
            <span class="conf ${cls}">${escapeHtml(label)}</span>
          </div>
          <div class="extracted">
            <span class="key">Titre</span>${titleVal}
            <span class="key">${numberWord}</span>${epVal}
            ${isManga ? '' : `<span class="key">Saison</span>${seasonVal}`}
          </div>
          ${reasonHtml}
          ${evidence}
        </div>
      `;
    })
    .join('');

  return `
    <h3>Choisis la stratégie qui a trouvé les bonnes valeurs</h3>
    <p class="small">L'extension a besoin du <strong>titre</strong> et du <strong>numéro de ${numberWordLow}</strong>. Les stratégies qui n'ont trouvé que l'un ou l'autre sont désactivées.</p>
    <style>
      .strategy-blocked {
        margin-top: 8px;
        padding: 6px 10px;
        background: rgba(248, 113, 113, 0.06);
        border: 1px solid rgba(248, 113, 113, 0.18);
        border-radius: 6px;
        font-size: 11px;
        color: oklch(0.704 0.191 22.216);
      }
      .strategy-manual {
        margin-top: 10px;
        padding: 12px;
        border: 1px dashed rgba(60, 90, 166, 0.4);
        border-radius: 8px;
        background: rgba(60, 90, 166, 0.06);
        cursor: pointer;
        transition: background 120ms, border-color 120ms;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .strategy-manual:hover {
        background: rgba(60, 90, 166, 0.14);
        border-color: oklch(66.906% 0.18376 248.826);
      }
      .strategy-manual .manual-title {
        font-size: 13px;
        font-weight: 600;
        color: oklch(0.985 0.002 247.839);
      }
      .strategy-manual .manual-desc {
        font-size: 11px;
        color: oklch(86.989% 0.06369 262.465);
        margin-top: 2px;
      }
      .strategy-manual .manual-arrow {
        flex-shrink: 0;
        font-size: 18px;
        color: oklch(66.906% 0.18376 248.826);
      }
    </style>
    <div class="strategy-list">${list}</div>
    <div class="strategy-manual" id="wiz-go-manual" role="button" tabindex="0">
      <div>
        <div class="manual-title">Aucune ne marche ? Configurer manuellement</div>
        <div class="manual-desc">Pointe toi-même le titre et le numéro de ${numberWordLow} dans la page.</div>
      </div>
      <span class="manual-arrow">→</span>
    </div>
    <div class="footer" style="margin: 18px -20px 0;">
      <button class="btn secondary" id="wiz-back-welcome">Retour</button>
      <div class="right">
        <button class="btn primary" id="wiz-confirm-strategy" disabled>Valider la stratégie</button>
      </div>
    </div>
  `;
}

function renderManual(manual: ManualSelection, kind: 'anime' | 'manga'): string {
  const isManga = kind === 'manga';
  const numberLabel = isManga ? 'Chapitre' : 'Épisode';
  const numberLow = isManga ? 'chapitre' : 'épisode';

  const fieldRow = (
    field: PickField,
    selector: string | undefined,
    text: string | undefined,
    label: string,
    required: boolean,
  ) => {
    const filled = !!selector;
    return `
      <div class="field">
        <span class="field-label">${escapeHtml(label)}${required ? ' <span style="color: oklch(0.704 0.191 22.216)">*</span>' : ''}</span>
        <div class="field-value ${filled ? '' : 'empty'}">
          <div class="text">${filled ? escapeHtml(text ?? '(vide)') : 'Pas encore configuré'}</div>
          ${filled ? `<div class="selector">${escapeHtml(selector!)}</div>` : ''}
        </div>
        <div class="field-actions">
          <button class="btn small secondary" data-pick-field="${field}">${filled ? 'Re-pointer' : 'Pointer'}</button>
          ${filled ? `<button class="btn small ghost" data-clear-field="${field}">Effacer</button>` : ''}
        </div>
      </div>
    `;
  };

  const ready = !!(manual.title && manual.episode);
  return `
    <h3>Pointer les éléments dans la page</h3>
    <p class="small">Clique <strong>Pointer</strong>, puis clique sur l'élément correspondant dans la page.
    Le wizard se cache pendant la sélection. Esc annule.</p>
    ${fieldRow('title', manual.title, manual.titleText, 'Titre', true)}
    ${fieldRow('episode', manual.episode, manual.episodeText, numberLabel, true)}
    <p class="small muted">Le titre <strong>et</strong> le ${numberLow} sont obligatoires pour que le tracking fonctionne.</p>
    <div class="footer" style="margin: 18px -20px 0;">
      <button class="btn ghost" id="wiz-back-results">Retour aux stratégies</button>
      <div class="right">
        <button class="btn secondary" id="wiz-cancel">Annuler</button>
        <button class="btn primary" id="wiz-manual-validate" ${ready ? '' : 'disabled'}>Valider la configuration</button>
      </div>
    </div>
  `;
}

/**
 * Step affiché quand l'élément pointé contient plusieurs nombres.
 * On rend le textContent avec chaque nombre cliquable inline pour que l'user
 * pointe précisément le bon (« Witch Hat - [03] VOSTFR - [03] »).
 */
function renderTokenChoice(pending: PendingTokenChoice, kind: 'anime' | 'manga'): string {
  const isManga = kind === 'manga';
  const fieldLabel =
    pending.field === 'episode'
      ? isManga
        ? 'le numéro de chapitre'
        : "le numéro d'épisode"
      : 'le numéro de saison';

  // Construit un rendu HTML : alterne text statique et boutons cliquables sur
  // chaque match. On utilise `String.prototype.matchAll` avec /\d+/g pour
  // garder les positions exactes.
  const re = /\d{1,4}/g;
  let html = '';
  let lastEnd = 0;
  let matchIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pending.rawText)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > lastEnd) {
      html += `<span class="token-text">${escapeHtml(pending.rawText.slice(lastEnd, start))}</span>`;
    }
    html += `<button class="token-pick" data-token-index="${matchIdx}">${escapeHtml(m[0])}</button>`;
    lastEnd = end;
    matchIdx++;
  }
  if (lastEnd < pending.rawText.length) {
    html += `<span class="token-text">${escapeHtml(pending.rawText.slice(lastEnd))}</span>`;
  }

  return `
    <h3>Quel nombre est ${escapeHtml(fieldLabel)} ?</h3>
    <p class="small">Cet élément contient plusieurs nombres. Clique sur celui qui correspond.</p>
    <style>
      .token-line {
        padding: 14px 16px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 8px;
        font-size: 14px;
        line-height: 1.8;
        word-break: break-word;
      }
      .token-line .token-text { color: oklch(86.989% 0.06369 262.465); }
      .token-line .token-pick {
        display: inline-block;
        padding: 2px 10px;
        margin: 0 1px;
        border-radius: 6px;
        background: rgba(60, 90, 166, 0.2);
        color: oklch(0.985 0.002 247.839);
        border: 1px solid rgba(60, 90, 166, 0.5);
        font-size: 14px; font-weight: 600;
        cursor: pointer;
        font-family: ${FONT_STACK};
        transition: background 120ms, transform 80ms;
      }
      .token-line .token-pick:hover {
        background: oklch(66.906% 0.18376 248.826);
        color: #030a1d;
      }
      .token-line .token-pick:active { transform: scale(0.95); }
    </style>
    <div class="token-line">${html}</div>
    <p class="small muted" style="margin-top: 12px;">Si aucun ne convient, retourne en arrière et pointe un autre élément.</p>
    <div class="footer" style="margin: 18px -20px 0;">
      <button class="btn ghost" id="wiz-token-cancel">Retour</button>
      <div class="right"></div>
    </div>
  `;
}

function renderTrackingManga(state: WizardState): string {
  const tracking = state.mangaTracking ?? { mode: 'manual' as MangaTrackingMode };
  const isMode = (m: MangaTrackingMode) => tracking.mode === m;

  const card = (mode: MangaTrackingMode, title: string, desc: string, hint?: string) => `
    <div class="strategy ${isMode(mode) ? 'selected' : ''}" data-tracking-mode="${mode}">
      <div class="strategy-header">
        <div>
          <div class="strategy-label">${escapeHtml(title)}</div>
          <div class="strategy-desc">${escapeHtml(desc)}</div>
        </div>
      </div>
      ${hint ? `<div class="extracted"><span class="key">Sélecteur</span><span class="val">${escapeHtml(hint)}</span></div>` : ''}
    </div>
  `;

  const needsSelector =
    (tracking.mode === 'page-counter' || tracking.mode === 'next-button') && !tracking.selector;

  const pickRow =
    tracking.mode === 'page-counter'
      ? `<button class="btn primary" id="wiz-pick-counter" type="button">${tracking.selector ? 'Re-pointer le compteur' : 'Pointer le compteur (X / Y)'}</button>`
      : tracking.mode === 'next-button'
        ? `<button class="btn primary" id="wiz-pick-next" type="button">${tracking.selector ? 'Re-pointer le bouton' : 'Pointer le bouton « chapitre suivant »'}</button>`
        : '';

  return `
    <h3>Comment marquer un chapitre comme lu ?</h3>
    <p class="small">Choisis le mode qui correspond à la lecture sur ce site. Tu pourras toujours marquer manuellement depuis le popup.</p>
    <div class="strategy-list">
      ${card('manual', 'Manuel', 'Aucun déclencheur automatique. Tu cliques « Marquer chapitre lu » dans le popup quand tu as fini.')}
      ${card('scroll', 'Défilement', 'Marqué automatiquement quand tu as scrollé > 90 % du lecteur. Auto-détection du conteneur scrollable.', tracking.mode === 'scroll' ? tracking.selector : undefined)}
      ${card('page-counter', 'Compteur de page', 'Lit un compteur dans le DOM (ex. « 12 / 24 ») et marque lu quand la dernière page est atteinte.', tracking.mode === 'page-counter' ? tracking.selector : undefined)}
      ${card('next-button', 'Bouton « chapitre suivant »', 'Marque lu au clic sur un bouton de navigation que tu désignes.', tracking.mode === 'next-button' ? tracking.selector : undefined)}
    </div>
    ${tracking.mode === 'scroll' ? `
      <p class="small muted" style="margin-top: 10px;">Sur les sites en mode « application » où la page entière ne scrolle pas, pointe le conteneur du lecteur (optionnel — l'auto-détection essaiera sinon).</p>
      <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn ${tracking.selector ? 'secondary' : 'primary'}" id="wiz-pick-scroll-container" type="button">${tracking.selector ? 'Re-pointer le conteneur' : 'Pointer le conteneur scrollable (optionnel)'}</button>
        ${tracking.selector ? `<button class="btn ghost" id="wiz-clear-scroll-container" type="button">Auto-détecter</button>` : ''}
      </div>
    ` : ''}
    ${pickRow ? `<div style="margin-top:12px;display:flex;gap:8px;">${pickRow}</div>` : ''}
    <div class="footer" style="margin: 18px -20px 0;">
      <button class="btn secondary" id="wiz-tracking-back" type="button">Retour</button>
      <div class="right">
        <button class="btn primary" id="wiz-tracking-next" type="button" ${needsSelector ? 'disabled' : ''}>Continuer</button>
      </div>
    </div>
  `;
}

function renderConfirm(state: WizardState): string {
  const isManga = state.kind === 'manga';
  const numberLabel = isManga ? 'Chapitre' : 'Épisode';
  let summary = '';

  if (state.chosenStrategy === 'manual') {
    summary = `
      <div class="extracted">
        <span class="key">Stratégie</span><span class="val">Manuelle (sélecteurs CSS)</span>
        <span class="key">Titre</span><span class="val">${escapeHtml(state.manual.titleText ?? '')}</span>
        ${state.manual.episode ? `<span class="key">${numberLabel}</span><span class="val">${escapeHtml(state.manual.episodeText ?? '')}</span>` : ''}
        ${!isManga && state.manual.season ? `<span class="key">Saison</span><span class="val">${escapeHtml(state.manual.seasonText ?? '')}</span>` : ''}
      </div>
    `;
  } else {
    const r = state.results.find((x) => x.id === state.chosenStrategy);
    if (r) {
      summary = `
        <div class="extracted">
          <span class="key">Stratégie</span><span class="val">${escapeHtml(r.label)}</span>
          <span class="key">Titre</span><span class="val">${escapeHtml(r.title ?? '—')}</span>
          ${r.episode !== undefined ? `<span class="key">${numberLabel}</span><span class="val">${escapeHtml(r.episode)}</span>` : ''}
          ${!isManga && r.season !== undefined ? `<span class="key">Saison</span><span class="val">${escapeHtml(r.season)}</span>` : ''}
        </div>
      `;
    }
  }

  const trackingSummary =
    state.kind === 'manga' && state.mangaTracking
      ? `
        <div class="extracted" style="margin-top:8px;">
          <span class="key">Tracking</span><span class="val">${escapeHtml(trackingModeLabel(state.mangaTracking.mode))}</span>
          ${state.mangaTracking.selector ? `<span class="key">Sélecteur</span><span class="val">${escapeHtml(state.mangaTracking.selector)}</span>` : ''}
        </div>`
      : '';

  return `
    <h3>Sauvegarder cette configuration ?</h3>
    <p class="small">Le pattern sera utilisé sur <strong>${escapeHtml(location.hostname)}</strong> pour détecter automatiquement la série et ${state.kind === 'manga' ? 'le chapitre' : "l'épisode"}.
    Stocké uniquement dans ton navigateur — jamais transmis à Actunime.</p>
    ${summary}
    ${trackingSummary}
    <p class="small muted" style="margin-top: 12px;">Tu peux le retirer ou le modifier à tout moment depuis les paramètres.</p>
    <div class="save-status" id="wiz-save-status"></div>
    <div class="footer" style="margin: 18px -20px 0;">
      <button class="btn ghost" id="wiz-back">Retour</button>
      <div class="right">
        <button class="btn secondary" id="wiz-cancel">Annuler</button>
        <button class="btn primary" id="wiz-save">Sauvegarder</button>
      </div>
    </div>
  `;
}

function trackingModeLabel(mode: MangaTrackingMode): string {
  switch (mode) {
    case 'manual':
      return 'Manuel (bouton popup)';
    case 'scroll':
      return 'Défilement de la page';
    case 'page-counter':
      return 'Compteur de page (DOM)';
    case 'next-button':
      return 'Bouton « chapitre suivant »';
  }
}
