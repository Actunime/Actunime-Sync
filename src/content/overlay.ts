/**
 * Overlay Shadow DOM aligné DA Actunime (theme dark).
 *
 *  - `showToast(message)` : notification simple, auto-dismiss court
 *  - `showConfirmationCard(...)` : carte interactive avec choix de candidats,
 *    recherche manuelle (« vous ne trouvez pas ? »), toggle rewatch, suggestion
 *    d'alias post-confirmation. **Pas d'auto-dismiss.**
 */

import {
  sendMessage,
  type CandidateMedia,
  type FetchImageResultPayload,
  type ResearchResultPayload,
  type SuggestAliasResultPayload,
} from '@/shared/messaging';

const TOAST_ID = 'actunime-tracker-overlay';
const BADGE_ID = 'actunime-tracker-badge';
const CONFIG_PROMPT_ID = 'actunime-tracker-config-prompt';
const FONT_STACK =
  "'Outfit Variable', 'Outfit', system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

type ToastKind = 'success' | 'error' | 'info';
const TOAST_BORDERS: Record<ToastKind, string> = {
  success: '#34d399',
  info: 'oklch(66.906% 0.18376 248.826)',
  error: '#f87171',
};

const STATUS_LABELS: Record<string, string> = {
  WATCHING: 'En cours',
  READING: 'En cours',
  COMPLETED: 'Terminé',
  ON_HOLD: 'En pause',
  DROPPED: 'Abandonné',
  PLAN_TO_WATCH: 'Planifié',
  PLAN_TO_READ: 'Planifié',
};

function removeExisting() {
  const el = document.getElementById(TOAST_ID);
  if (el) el.remove();
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cssEscape(s: string): string {
  return s.replace(/"/g, '\\"');
}

// ───────────────────────────── Toast simple ─────────────────────────────────

/**
 * Toast avec un bouton d'action (ex: « Annuler » sur le toast de confirmation
 * de push). Le toast disparaît au clic ou après `durationMs`. Retourne une
 * promise résolue avec `true` si l'user a cliqué l'action, `false` si timeout.
 */
export function showActionToast(opts: {
  message: string;
  actionLabel: string;
  kind?: ToastKind;
  durationMs?: number;
}): Promise<boolean> {
  removeExisting();
  const kind = opts.kind ?? 'success';
  const border = TOAST_BORDERS[kind];
  const duration = opts.durationMs ?? 8_000;

  return new Promise<boolean>((resolve) => {
    const host = document.createElement('div');
    host.id = TOAST_ID;
    host.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:2147483647;font-family:${FONT_STACK};`;
    const shadow = host.attachShadow({ mode: 'closed' });

    let resolved = false;
    const finish = (clicked: boolean) => {
      if (resolved) return;
      resolved = true;
      removeExisting();
      resolve(clicked);
    };

    shadow.innerHTML = `
      <style>
        .toast {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 12px; border-radius: 10px;
          background: #030a1d; color: #fafafa;
          border: 1px solid ${border};
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04);
          font-size: 13px; line-height: 1.4; max-width: 420px;
          font-family: ${FONT_STACK};
          animation: slideIn 220ms ease-out;
        }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: ${border}; flex: none; }
        .msg { flex: 1; }
        .action {
          flex: none; padding: 6px 12px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.06);
          color: oklch(0.985 0.002 247.839);
          border: 1px solid rgba(255, 255, 255, 0.12);
          font-size: 12px; font-weight: 500; cursor: pointer;
          font-family: ${FONT_STACK};
          transition: background 120ms;
        }
        .action:hover { background: rgba(255, 255, 255, 0.12); }
        .action:disabled { opacity: 0.5; cursor: wait; }
        @keyframes slideIn { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      </style>
      <div class="toast">
        <span class="dot"></span>
        <span class="msg">${escapeHtml(opts.message)}</span>
        <button class="action" id="actunime-action">${escapeHtml(opts.actionLabel)}</button>
      </div>
    `;

    document.documentElement.appendChild(host);

    const btn = shadow.querySelector<HTMLButtonElement>('#actunime-action');
    btn?.addEventListener('click', () => {
      if (btn) {
        btn.disabled = true;
        btn.textContent = '…';
      }
      finish(true);
    });

    setTimeout(() => finish(false), duration);
  });
}

export function showToast(message: string, kind: ToastKind = 'success', durationMs = 4000) {
  removeExisting();
  const border = TOAST_BORDERS[kind];
  const host = document.createElement('div');
  host.id = TOAST_ID;
  host.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:2147483647;font-family:${FONT_STACK};`;
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      .toast {
        display: flex; align-items: center; gap: 10px;
        padding: 12px 16px; border-radius: 10px;
        background: #030a1d; color: #fafafa;
        border: 1px solid ${border};
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04);
        font-size: 13px; line-height: 1.4; max-width: 360px;
        font-family: ${FONT_STACK};
        animation: slideIn 220ms ease-out;
      }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: ${border}; flex: none; }
      @keyframes slideIn { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    </style>
    <div class="toast"><span class="dot"></span><span>${escapeHtml(message)}</span></div>
  `;
  document.documentElement.appendChild(host);
  setTimeout(removeExisting, durationMs);
}

// ────────────────────────── Carte de confirmation ───────────────────────────

export type ConfirmationChoice =
  | {
      action: 'confirm';
      chosenMediaId: string;
      chosenTitle: string;
      chosenCoverUrl?: string | null;
      isRewatch: boolean;
      suggestAliasFor?: string;
      /** Si défini, le candidat choisi est une proposition PENDING. */
      proposalId?: string;
    }
  | { action: 'skip' }
  | { action: 'ignore_series' }
  | { action: 'open_contribution' }
  | { action: 'configure_site' };

export interface ConfirmationCardOptions {
  detectedTitle: string;
  episode?: number;
  season?: number;
  kind: 'anime' | 'manga';
  sourceUrl?: string;
  candidates: CandidateMedia[];
}

interface CardState {
  detectedTitle: string;
  kind: 'anime' | 'manga';
  /** Résultats initiaux (discovery), restaurés si l'user vide la recherche. */
  originalCandidates: CandidateMedia[];
  candidates: CandidateMedia[];
  chosenId?: string;
  isRewatch: boolean;
  suggestAlias: boolean;
}

/**
 * `true` si le titre détecté est déjà connu de l'anime (titre principal ou alias).
 * Comparaison case-insensitive + accent-insensitive.
 */
function isTitleAlreadyKnown(detectedTitle: string, anime?: CandidateMedia): boolean {
  if (!anime) return true; // pas de candidat → on cache la suggestion (rien à faire)
  const detected = detectedTitle?.trim();
  if (!detected) return true;
  const candidates = [anime.title, ...(anime.alias ?? [])].filter(Boolean) as string[];
  return candidates.some(
    (t) => t.localeCompare(detected, undefined, { sensitivity: 'accent' }) === 0,
  );
}

export function showConfirmationCard(opts: ConfirmationCardOptions): Promise<ConfirmationChoice> {
  console.log('showConfirmationCard', opts);
  removeExisting();
  return new Promise((resolve) => {
    try {
      const host = document.createElement('div');
      host.id = TOAST_ID;
      host.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:2147483647;font-family:${FONT_STACK};`;
      const shadow = host.attachShadow({ mode: 'closed' });

      const initialPick = opts.candidates[0];
      const state: CardState = {
        detectedTitle: opts.detectedTitle,
        kind: opts.kind,
        originalCandidates: opts.candidates,
        candidates: opts.candidates,
        chosenId: initialPick?.id,
        isRewatch: opts.kind === 'anime' && initialPick?.existingListEntry?.status === 'COMPLETED',
        suggestAlias: false,
      };

      shadow.innerHTML = renderShell(opts.detectedTitle, opts.episode, opts.season, opts.kind);
      renderCandidates(shadow, state);
      updateAliasSection(shadow, state);
      document.documentElement.appendChild(host);

      let resolved = false;
      const finish = (choice: ConfirmationChoice) => {
        if (resolved) return;
        resolved = true;
        removeExisting();
        resolve(choice);
      };

      // Boutons fixes (header + actions du bas)
      shadow
        .querySelector('#actunime-close')
        ?.addEventListener('click', () => finish({ action: 'skip' }));
      shadow.querySelector('#actunime-confirm')?.addEventListener('click', () => {
        if (!state.chosenId) return;
        const chosen = state.candidates.find((c) => c.id === state.chosenId);
        if (!chosen) return;
        const detected = state.detectedTitle?.trim();
        const shouldSuggest =
          state.suggestAlias && !!detected && !isTitleAlreadyKnown(detected, chosen);
        finish({
          action: 'confirm',
          chosenMediaId: state.chosenId,
          chosenTitle: chosen.title,
          chosenCoverUrl: chosen.coverUrl,
          isRewatch: state.isRewatch,
          suggestAliasFor: shouldSuggest ? detected : undefined,
          proposalId: chosen.isPending ? chosen.proposalId : undefined,
        });
      });
      shadow
        .querySelector('#actunime-skip')
        ?.addEventListener('click', () => finish({ action: 'skip' }));
      shadow
        .querySelector('#actunime-ignore')
        ?.addEventListener('click', () => finish({ action: 'ignore_series' }));
      shadow.querySelector('#actunime-configure-site')?.addEventListener('click', () => {
        finish({ action: 'configure_site' });
      });
      shadow.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement | null;
        const contributeBtn = target?.closest<HTMLButtonElement>(
          '#actunime-contribute, #actunime-search-contribute',
        );
        if (!contributeBtn) return;
        contributeBtn.disabled = true;
        const original = contributeBtn.textContent;
        contributeBtn.textContent = '…';
        const res = (await sendMessage({
          type: 'OPEN_CONTRIBUTION_FORM',
          payload: {
            kind: opts.kind,
            title: state.detectedTitle,
            season: opts.season,
            episode: opts.kind === 'anime' ? opts.episode : undefined,
            chapter: opts.kind === 'manga' ? opts.episode : undefined,
            sourceUrl: opts.sourceUrl,
          },
        })) as { ok: boolean; error?: string };
        if (res.ok) {
          finish({ action: 'open_contribution' });
          showToast(
            "Ouvre l'extension Actunime dans la barre d'outils pour finaliser ta proposition.",
            'info',
            7000,
          );
        } else {
          contributeBtn.disabled = false;
          contributeBtn.textContent = original;
        }
      });

      // Toggle rewatch
      const rewatchToggle = shadow.querySelector<HTMLInputElement>('#actunime-rewatch');
      rewatchToggle?.addEventListener('change', () => {
        state.isRewatch = rewatchToggle.checked;
      });

      // Toggle suggestion alias
      const aliasToggle = shadow.querySelector<HTMLInputElement>('#actunime-alias');
      aliasToggle?.addEventListener('change', () => {
        state.suggestAlias = aliasToggle.checked;
      });

      // Champ recherche manuelle
      const searchInput = shadow.querySelector<HTMLInputElement>('#actunime-search-input');
      const searchBtn = shadow.querySelector<HTMLButtonElement>('#actunime-search-btn');
      const searchStatus = shadow.querySelector<HTMLDivElement>('#actunime-search-status');

      const restoreOriginal = () => {
        state.candidates = state.originalCandidates;
        state.chosenId = state.originalCandidates[0]?.id;
        state.isRewatch =
          state.kind === 'anime' &&
          state.originalCandidates[0]?.existingListEntry?.status === 'COMPLETED';
        renderCandidates(shadow, state);
        if (rewatchToggle) rewatchToggle.checked = state.isRewatch;
        updateAliasSection(shadow, state);
        if (searchStatus) searchStatus.textContent = '';
      };

      const runSearch = async () => {
        const query = searchInput?.value?.trim() ?? '';
        // Champ vide → restaurer les résultats initiaux (discovery).
        if (query.length === 0) {
          restoreOriginal();
          return;
        }
        if (query.length < 2) {
          if (searchStatus) searchStatus.textContent = 'Au moins 2 caractères.';
          return;
        }
        if (searchBtn) {
          searchBtn.disabled = true;
          searchBtn.textContent = '…';
        }
        if (searchStatus) searchStatus.textContent = '';
        try {
          const res = (await sendMessage({
            type: 'RESEARCH_QUERY',
            payload: { query, kind: state.kind },
          })) as ResearchResultPayload;
          if (res.error) {
            if (searchStatus) {
              searchStatus.textContent = res.error;
              searchStatus.className = 'search-status';
            }
          } else if (res.empty || res.candidates.length === 0) {
            if (searchStatus) {
              searchStatus.className = 'search-status no-results';
              searchStatus.innerHTML = `<span>Aucun résultat.</span><button type="button" id="actunime-search-contribute" class="search-contribute">Proposer son ajout →</button>`;
            }
          } else {
            state.candidates = res.candidates;
            state.chosenId = res.candidates[0]?.id;
            state.isRewatch =
              state.kind === 'anime' &&
              res.candidates[0]?.existingListEntry?.status === 'COMPLETED';
            renderCandidates(shadow, state);
            if (rewatchToggle) rewatchToggle.checked = state.isRewatch;
            updateAliasSection(shadow, state);
            if (searchStatus) {
              searchStatus.textContent = '';
              searchStatus.className = 'search-status';
            }
          }
        } finally {
          if (searchBtn) {
            searchBtn.disabled = false;
            searchBtn.textContent = 'Rechercher';
          }
        }
      };

      searchBtn?.addEventListener('click', runSearch);
      searchInput?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') runSearch();
      });
    } catch (err) {
      console.error('showConfirmationCard error', err);
    }
  });
}

/**
 * Rend la liste des candidats (radio + cover + meta) et rebranche les listeners
 * de sélection. Appelée à l'initialisation et à chaque recherche manuelle.
 */
function renderCandidates(shadow: ShadowRoot, state: CardState) {
  const container = shadow.querySelector('#actunime-candidates');
  if (!container) return;

  if (state.candidates.length === 0) {
    container.innerHTML = emptyStateHtml(state.detectedTitle);
    setConfirmEnabled(shadow, false);
    return;
  }

  container.innerHTML = state.candidates
    .map((c) => candidateHtml(c, c.id === state.chosenId, state.kind))
    .join('');
  setConfirmEnabled(shadow, true);

  shadow.querySelectorAll<HTMLInputElement>('input[name="actunime-candidate"]').forEach((r) => {
    r.addEventListener('change', () => {
      state.chosenId = r.value;
      const cand = state.candidates.find((c) => c.id === r.value);
      const completed = cand?.existingListEntry?.status === 'COMPLETED';
      const rewatchToggle = shadow.querySelector<HTMLInputElement>('#actunime-rewatch');
      if (rewatchToggle) {
        rewatchToggle.checked = completed;
        state.isRewatch = completed;
      }
      shadow.querySelectorAll('.candidate').forEach((el) => el.classList.remove('selected'));
      r.closest('.candidate')?.classList.add('selected');
      updateAliasSection(shadow, state);
    });
  });

  void hydrateCovers(shadow, state.candidates);
}

/**
 * Affiche / cache le toggle de suggestion d'alias.
 *
 * Conditions cumulatives pour afficher :
 *  1. Un candidat est sélectionné, et le titre détecté n'est pas déjà dans
 *     son titre / ses alias (sinon l'ajout serait un doublon).
 *  2. Le candidat **n'est pas** dans les résultats de la discovery initiale
 *     (`originalCandidates`). Si Actunime trouve déjà l'œuvre depuis le titre
 *     détecté du site, l'alias n'apporte rien. L'alias n'a de valeur que
 *     quand l'user a dû chercher manuellement parce que la détection auto
 *     n'a pas proposé le bon résultat.
 */
function updateAliasSection(shadow: ShadowRoot, state: CardState) {
  const section = shadow.querySelector<HTMLElement>('#actunime-alias-section');
  const label = shadow.querySelector<HTMLElement>('#actunime-alias-label');
  const checkbox = shadow.querySelector<HTMLInputElement>('#actunime-alias');
  if (!section || !label || !checkbox) return;

  const chosen = state.candidates.find((c) => c.id === state.chosenId);
  const detected = state.detectedTitle?.trim();
  const inOriginal = !!chosen && state.originalCandidates.some((o) => o.id === chosen.id);
  const known = isTitleAlreadyKnown(detected, chosen);

  if (!chosen || !detected || known || inOriginal) {
    section.style.display = 'none';
    checkbox.checked = false;
    state.suggestAlias = false;
    return;
  }

  section.style.display = 'flex';
  label.innerHTML = `+ Ajouter <strong>« ${escapeHtml(detected)} »</strong> comme synonyme à <strong>« ${escapeHtml(chosen.title)} »</strong> <span class="hint">(la détection auto n'a pas trouvé cette œuvre — aide les futurs utilisateurs)</span>`;
}

async function hydrateCovers(shadow: ShadowRoot, candidates: CandidateMedia[]) {
  await Promise.all(
    candidates.map(async (c) => {
      if (!c.coverUrl) {
        console.info('[Actunime overlay] no coverUrl for', c.id, c.title);
        return;
      }
      const img = shadow.querySelector<HTMLImageElement>(
        `img[data-cover-for="${cssEscape(c.id)}"]`,
      );
      if (!img) return;
      if (c.coverUrl.startsWith('data:')) {
        img.src = c.coverUrl;
        return;
      }
      try {
        const res = (await sendMessage({
          type: 'FETCH_IMAGE',
          payload: { url: c.coverUrl },
        })) as FetchImageResultPayload;
        if (!res.ok || !res.dataUrl) {
          console.info('[Actunime overlay] fetch failed', c.coverUrl, res.error);
          return;
        }
        img.src = res.dataUrl;
      } catch (err) {
        console.info('[Actunime overlay] fetch crashed', c.coverUrl, err);
      }
    }),
  );
}

function emptyStateHtml(detectedTitle: string): string {
  return `
    <div class="empty">
      <div class="empty-icon">⊘</div>
      <div class="empty-text">
        <strong>${escapeHtml(detectedTitle)}</strong> n'est pas (encore) sur Actunime.
      </div>
      <button class="empty-contribute" id="actunime-contribute" type="button">
        Proposer son ajout en quelques clics et ajoute-le à ta liste pour le suivi automatique
      </button>
      <div class="empty-hint">
        Pas le bon résultat ? Tente une recherche manuelle ci-dessous.
      </div>
    </div>
  `;
}

function setConfirmEnabled(shadow: ShadowRoot, enabled: boolean) {
  const btn = shadow.querySelector<HTMLButtonElement>('#actunime-confirm');
  if (!btn) return;
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? '1' : '0.4';
  btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
}

function candidateHtml(c: CandidateMedia, selected: boolean, kind: 'anime' | 'manga'): string {
  const checked = selected ? 'checked' : '';
  const selectedCls = selected ? 'selected' : '';
  const year = c.year ? ` <span class="year">(${escapeHtml(String(c.year))})</span>` : '';
  const cover = `<img class="cover" data-cover-for="${escapeHtml(c.id)}" alt="" />`;
  const isManga = kind === 'manga';
  const consumedNum = isManga
    ? c.existingListEntry?.chaptersRead
    : c.existingListEntry?.episodesWatched;
  const consumedAbbr = isManga ? 'ch' : 'ep';
  const pendingBadge = c.isPending
    ? `<span class="badge-pending">${c.supportCount && c.supportCount > 1 ? `Proposition · ${c.supportCount} soutiens` : 'Proposition en attente'}</span>`
    : '';
  const status = c.existingListEntry
    ? `<span class="badge-status">${escapeHtml(STATUS_LABELS[c.existingListEntry.status] ?? c.existingListEntry.status)}${
        consumedNum !== undefined ? ` · ${consumedAbbr} ${consumedNum}` : ''
      }</span>`
    : pendingBadge;
  const score = c.score ? `<span class="score">${Math.round(c.score * 100)}%</span>` : '';
  return `
    <label class="candidate ${selectedCls}">
      <input type="radio" name="actunime-candidate" value="${escapeHtml(c.id)}" ${checked} />
      ${cover}
      <div class="meta">
        <div class="title">${escapeHtml(c.title)}${year}</div>
        <div class="row">${status}${score}</div>
      </div>
    </label>
  `;
}

/**
 * Gabarit fixe (header, search, candidates container vide, toggles, actions).
 * Le contenu de `#actunime-candidates` est rempli par `renderCandidates`.
 */
function renderShell(
  detectedTitle: string,
  episode: number | undefined,
  season: number | undefined,
  kind: 'anime' | 'manga' = 'anime',
): string {
  const isManga = kind === 'manga';
  const itemWordCap = isManga ? 'Chapitre' : 'Épisode';
  const headerText = isManga ? 'Suivre ce chapitre ?' : 'Suivre cet épisode ?';
  const placeholder = isManga ? 'Titre exact du manga…' : "Titre exact de l'anime…";
  const rewatchLabel = isManga ? '↻ Marquer comme relecture' : '↻ Marquer comme rewatch';
  const epLabel = episode ? ` · ${itemWordCap} ${episode}` : '';
  const seasonLabel = !isManga && season ? ` · Saison ${season}` : '';

  return `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }

      .card {
        width: 420px; max-width: calc(100vw - 48px);
        background: #030a1d;
        color: oklch(0.985 0.002 247.839);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(60, 90, 166, 0.15);
        font-family: ${FONT_STACK};
        font-size: 13px; line-height: 1.45;
        animation: slideIn 280ms cubic-bezier(0.2, 0.9, 0.3, 1);
        overflow: hidden;
      }
      @keyframes slideIn { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

      .header {
        display: flex; align-items: flex-start; justify-content: space-between;
        padding: 14px 16px 12px;
        background: linear-gradient(180deg, #0c1945 0%, #030a1d 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }
      .header h3 {
        margin: 0; font-size: 14px; font-weight: 600;
        color: oklch(0.985 0.002 247.839);
        letter-spacing: -0.01em;
      }
      .header .sub { margin-top: 4px; font-size: 11px; color: oklch(86.989% 0.06369 262.465); }
      .header .badge-actunime {
        display: inline-block; margin-right: 8px; padding: 2px 8px;
        border-radius: 4px; font-size: 10px; font-weight: 600;
        background: oklch(66.906% 0.18376 248.826);
        color: #030a1d; letter-spacing: 0.04em; text-transform: uppercase;
      }
      .close {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        color: oklch(86.989% 0.06369 262.465);
        cursor: pointer; font-size: 16px; line-height: 1;
        width: 28px; height: 28px; border-radius: 6px;
        display: flex; align-items: center; justify-content: center;
        transition: background 120ms, color 120ms;
      }
      .close:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }

      /* ~2 cartes visibles, scroll au-delà */
      .candidates {
        padding: 10px;
        max-height: 200px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .candidates::-webkit-scrollbar { width: 6px; }
      .candidates::-webkit-scrollbar-track { background: transparent; }
      .candidates::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
      }
      .candidates::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }

      .candidate {
        display: flex; gap: 12px; padding: 10px;
        border-radius: 8px; cursor: pointer; align-items: center;
        border: 1px solid transparent;
        background: rgba(60, 90, 166, 0.06);
        transition: background 120ms, border-color 120ms;
      }
      .candidate:hover {
        background: rgba(60, 90, 166, 0.14);
        border-color: rgba(60, 90, 166, 0.3);
      }
      .candidate.selected {
        background: rgba(60, 90, 166, 0.22);
        border-color: oklch(66.906% 0.18376 248.826);
      }
      .candidate input { margin: 0; accent-color: oklch(66.906% 0.18376 248.826); flex: none; }

      .cover {
        width: 44px; height: 62px; border-radius: 4px; object-fit: cover; flex: none;
        background: #102866;
        border: 1px solid rgba(255, 255, 255, 0.04);
      }

      .meta { flex: 1; min-width: 0; }
      .title {
        font-weight: 500; font-size: 13px;
        color: oklch(0.985 0.002 247.839);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .year { color: oklch(86.989% 0.06369 262.465); font-weight: 400; font-size: 11px; }
      .row { margin-top: 6px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

      .badge-status {
        display: inline-block; padding: 3px 8px; border-radius: 4px;
        background: rgba(60, 90, 166, 0.25);
        color: oklch(86.989% 0.06369 262.465);
        font-size: 10px; font-weight: 500;
        border: 1px solid rgba(60, 90, 166, 0.4);
      }
      .badge-pending {
        display: inline-block; padding: 3px 8px; border-radius: 4px;
        background: rgba(245, 158, 11, 0.15);
        color: oklch(81.668% 0.14032 67.264);
        font-size: 10px; font-weight: 600;
        border: 1px solid rgba(245, 158, 11, 0.35);
        text-transform: uppercase; letter-spacing: 0.04em;
      }
      .score { color: oklch(86.989% 0.06369 262.465); font-size: 10px; font-weight: 500; opacity: 0.75; }

      .search {
        padding: 10px 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(0, 0, 0, 0.15);
      }
      .search-label {
        font-size: 11px;
        color: oklch(86.989% 0.06369 262.465);
        margin-bottom: 6px;
      }
      .search-row { display: flex; gap: 6px; }
      .search input {
        flex: 1; padding: 7px 10px;
        border-radius: 6px;
        background: #000616;
        color: oklch(0.985 0.002 247.839);
        border: 1px solid rgba(255, 255, 255, 0.08);
        font-size: 12px;
        font-family: ${FONT_STACK};
        outline: none;
        transition: border-color 120ms;
      }
      .search input:focus { border-color: oklch(66.906% 0.18376 248.826); }
      .search button {
        padding: 7px 12px;
        border-radius: 6px;
        background: rgba(60, 90, 166, 0.25);
        color: oklch(0.985 0.002 247.839);
        border: 1px solid rgba(60, 90, 166, 0.4);
        font-size: 12px; font-weight: 500; cursor: pointer;
        font-family: ${FONT_STACK};
        transition: background 120ms;
      }
      .search button:hover { background: rgba(60, 90, 166, 0.4); }
      .search button:disabled { opacity: 0.5; cursor: wait; }
      .search-status {
        margin-top: 6px;
        font-size: 11px;
        color: oklch(86.989% 0.06369 262.465);
        min-height: 14px;
      }
      .search-status.no-results {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }
      .search-contribute {
        background: oklch(66.906% 0.18376 248.826);
        color: #030a1d;
        border: none;
        border-radius: 5px;
        padding: 4px 10px;
        font-size: 11px; font-weight: 600;
        cursor: pointer;
        font-family: ${FONT_STACK};
        transition: background 120ms;
      }
      .search-contribute:hover { background: oklch(72% 0.18 248.826); }
      .search-contribute:disabled { cursor: wait; opacity: 0.6; }

      .toggle {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 16px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 12px; color: oklch(86.989% 0.06369 262.465);
        cursor: pointer; user-select: none;
        transition: background 120ms;
      }
      .toggle:hover { background: rgba(255, 255, 255, 0.02); }
      .toggle input {
        accent-color: oklch(66.906% 0.18376 248.826);
        width: 14px; height: 14px;
      }
      .toggle .hint {
        font-size: 10px;
        color: oklch(86.989% 0.06369 262.465);
        opacity: 0.7;
        margin-left: 4px;
      }
      .alias-toggle {
        align-items: flex-start;
        line-height: 1.5;
      }
      .alias-toggle input { margin-top: 2px; }
      .alias-label strong {
        color: oklch(0.985 0.002 247.839);
        font-weight: 600;
      }

      .hint-configure {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 16px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(60, 90, 166, 0.08);
        font-size: 11px;
        color: oklch(86.989% 0.06369 262.465);
      }
      .hint-configure .hint-action {
        margin-left: auto;
        padding: 5px 10px;
        background: rgba(60, 90, 166, 0.25);
        color: oklch(0.985 0.002 247.839);
        border: 1px solid rgba(60, 90, 166, 0.45);
        border-radius: 6px;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        font-family: ${FONT_STACK};
        transition: background 120ms;
      }
      .hint-configure .hint-action:hover { background: rgba(60, 90, 166, 0.4); }

      .actions {
        display: flex; gap: 8px; padding: 10px 12px 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(0, 0, 0, 0.15);
      }
      button.action {
        flex: 1; padding: 9px 12px;
        border-radius: 6px;
        font-size: 12px; font-weight: 500; cursor: pointer;
        font-family: ${FONT_STACK};
        transition: background 120ms, border-color 120ms, transform 80ms;
      }
      button.action:active { transform: scale(0.97); }
      button.action.primary {
        background: oklch(66.906% 0.18376 248.826);
        color: #030a1d;
        border: 1px solid oklch(66.906% 0.18376 248.826);
        font-weight: 600;
      }
      button.action.primary:hover { background: oklch(72% 0.18 248.826); }
      button.action.secondary {
        background: rgba(255, 255, 255, 0.04);
        color: oklch(0.985 0.002 247.839);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      button.action.secondary:hover {
        background: rgba(255, 255, 255, 0.08);
        border-color: rgba(255, 255, 255, 0.12);
      }
      button.action.danger {
        background: transparent;
        color: oklch(0.704 0.191 22.216);
        border: 1px solid rgba(248, 113, 113, 0.25);
      }
      button.action.danger:hover {
        background: rgba(248, 113, 113, 0.08);
        border-color: rgba(248, 113, 113, 0.4);
      }
      button.action:disabled { cursor: not-allowed; }

      .empty {
        display: flex; flex-direction: column; align-items: center;
        text-align: center; padding: 24px 16px;
        color: oklch(86.989% 0.06369 262.465);
      }
      .empty-icon {
        font-size: 32px; line-height: 1;
        margin-bottom: 12px;
        color: oklch(66.906% 0.18376 248.826);
        opacity: 0.6;
      }
      .empty-text {
        font-size: 13px;
        color: oklch(0.985 0.002 247.839);
        margin-bottom: 6px;
      }
      .empty-text strong {
        color: oklch(66.906% 0.18376 248.826);
        font-weight: 600;
      }
      .empty-contribute {
        margin: 14px 0 10px;
        max-width: 360px;
        padding: 10px 16px;
        background: oklch(66.906% 0.18376 248.826);
        color: #030a1d;
        border: 1px solid oklch(66.906% 0.18376 248.826);
        border-radius: 8px;
        font-size: 12.5px; font-weight: 600;
        line-height: 1.4;
        cursor: pointer;
        font-family: ${FONT_STACK};
        transition: background 120ms;
      }
      .empty-contribute:hover { background: oklch(72% 0.18 248.826); }
      .empty-contribute:disabled { cursor: wait; opacity: 0.6; }
      .empty-hint {
        font-size: 11px;
        line-height: 1.5;
        opacity: 0.85;
        max-width: 320px;
      }
    </style>
    <div class="card">
      <div class="header">
        <div>
          <h3><span class="badge-actunime">Actunime</span>${escapeHtml(headerText)}</h3>
          <div class="sub">${escapeHtml(detectedTitle)}${epLabel}${seasonLabel}</div>
        </div>
        <button class="close" id="actunime-close" aria-label="Fermer">×</button>
      </div>
      <div class="candidates" id="actunime-candidates"></div>
      <div class="search">
        <div class="search-label">Pas le bon résultat ? Recherche manuelle :</div>
        <div class="search-row">
          <input type="text" id="actunime-search-input" placeholder="${escapeHtml(placeholder)}" />
          <button id="actunime-search-btn">Rechercher</button>
        </div>
        <div class="search-status" id="actunime-search-status"></div>
      </div>
      ${
        isManga
          ? ''
          : `<label class="toggle">
        <input type="checkbox" id="actunime-rewatch" />
        <span>${escapeHtml(rewatchLabel)}</span>
      </label>`
      }
      <label class="toggle alias-toggle" id="actunime-alias-section" style="display:none;">
        <input type="checkbox" id="actunime-alias" />
        <span class="alias-label" id="actunime-alias-label"></span>
      </label>
      <div class="hint-configure">
        <span>Le titre détecté semble incorrect ?</span>
        <button class="hint-action" id="actunime-configure-site" title="Lance l'assistant de configuration pour pointer le bon titre dans la page">Configurer ce site</button>
      </div>
      <div class="actions">
        <button class="action primary" id="actunime-confirm">Suivre</button>
        <button class="action secondary" id="actunime-skip">Pas maintenant</button>
        <button class="action danger" id="actunime-ignore" title="Ne plus me proposer pour cette série">Ignorer</button>
      </div>
    </div>
  `;
}

// ──────────────────────── Helper exposé pour main.ts ────────────────────────

/**
 * Envoie une suggestion d'alias au background. Best-effort — l'extension
 * affichera juste un toast d'info en retour. Géré côté API ultérieurement
 * (pour V0.2 le handler est un stub qui retourne false).
 */
export async function suggestAlias(
  animeId: string,
  alias: string,
): Promise<SuggestAliasResultPayload> {
  return await sendMessage({
    type: 'SUGGEST_ALIAS',
    payload: { animeId, alias },
  });
}

// ─────────────────────── Badge persistant « Vous regardez … » ───────────────

export interface WatchingBadgeOptions {
  /** Type de média — adapte les libellés (épisode/chapitre, regardes/lis). */
  kind?: 'anime' | 'manga';
  /** Titre Actunime affiché dans le badge. */
  matchedTitle: string;
  /** URL absolue du poster, optionnel. */
  coverUrl?: string | null;
  episode?: number;
  chapter?: number;
  season?: number;
  /** Mode de tracking actif → adapte le message. */
  mode: 'audio' | 'manual';
  /** État de la liste user pour cet anime/manga (statut + épisodes/chapitres). */
  listProgress?: {
    status: string;
    episodesWatched?: number;
    chaptersRead?: number;
    rewatchCount?: number;
  } | null;
  /** Durée d'affichage avant auto-dismiss. Défaut 7 s. */
  durationMs?: number;
  /** Callback : l'user veut corriger le choix. */
  onEdit: () => void | Promise<void>;
  /** Callback : l'user clique « Marquer vu maintenant ». */
  onMarkNow: () => void | Promise<void>;
  /** Callback : l'user clique « Ignorer cette série ». */
  onIgnore: () => void | Promise<void>;
  /** Callback : l'user veut reconfigurer le pattern du site (relance le wizard). */
  onReconfigure?: () => void | Promise<void>;
  /** Bouton expérimental « Reprendre au chap./ép. N » — fourni si pattern d'URL détecté + retard sur la liste. */
  resume?: {
    targetNumber: number;
    onResume: () => void | Promise<void>;
  };
}

/**
 * Formate le statut courant de la liste user pour affichage dans le badge.
 * Inclut un indicateur si l'épisode courant est en avance/retard sur ce qui
 * a déjà été vu.
 */
function formatListProgress(
  progress: WatchingBadgeOptions['listProgress'],
  currentNumber: number | undefined,
  kind: 'anime' | 'manga' = 'anime',
): string {
  if (!progress) return '';
  const statusLabels: Record<string, string> = {
    WATCHING: 'En cours',
    READING: 'En cours',
    COMPLETED: 'Terminé',
    ON_HOLD: 'En pause',
    DROPPED: 'Abandonné',
    PLAN_TO_WATCH: 'Planifié',
    PLAN_TO_READ: 'Planifié',
  };
  const status = statusLabels[progress.status] ?? progress.status;
  const consumed =
    kind === 'manga' ? (progress.chaptersRead ?? 0) : (progress.episodesWatched ?? 0);
  const consumedLabel = kind === 'manga' ? 'lus' : 'vus';
  const nextLabel = kind === 'manga' ? 'prochain chapitre' : 'prochain épisode';
  const seenLabel = kind === 'manga' ? 'déjà lu' : 'déjà vu';

  let suffix = '';
  if (currentNumber !== undefined) {
    if (currentNumber === consumed + 1) suffix = ` · ${nextLabel}`;
    else if (currentNumber <= consumed) suffix = ` · ${seenLabel}`;
    else if (currentNumber > consumed + 1) suffix = ` · saut ${currentNumber - consumed - 1}`;
  }
  const rewatchHint =
    kind === 'anime' && progress.rewatchCount && progress.rewatchCount > 0
      ? ` · ${progress.rewatchCount}× rewatch`
      : '';
  return `${escapeHtml(status)} · ${consumed} ${consumedLabel}${suffix}${rewatchHint}`;
}

/**
 * Affiche un badge en bas-droite confirmant l'œuvre suivie. Auto-dismiss
 * après `durationMs` (7 s par défaut). Le hover sur le badge met le timer
 * en pause pour laisser le temps de cliquer un bouton.
 *
 * Coexiste avec `showToast` / `showConfirmationCard` qui utilisent un autre ID.
 */
export function showWatchingBadge(opts: WatchingBadgeOptions): void {
  removeWatchingBadge();
  const host = document.createElement('div');
  host.id = BADGE_ID;
  host.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:2147483646;font-family:${FONT_STACK};`;
  const shadow = host.attachShadow({ mode: 'closed' });

  const isManga = opts.kind === 'manga';
  const currentNumber = isManga ? opts.chapter : opts.episode;
  const numberWordCap = isManga ? 'Chapitre' : 'Épisode';
  const ceNumberWord = isManga ? 'ce chapitre' : 'cet épisode';
  const auNumberWord = isManga ? 'au chapitre' : "à l'épisode";
  const epText = currentNumber
    ? `${numberWordCap} ${currentNumber}`
    : `Numéro ${isManga ? 'de chapitre' : "d'épisode"} non détecté`;
  const seasonHint = !isManga && opts.season ? ` (saison ${opts.season})` : '';
  const labelHeader = isManga ? 'Vous lisez' : 'Vous regardez';
  const markBtnLabel = isManga ? 'Marquer lu' : 'Marquer vu';

  const listProgressLabel = formatListProgress(opts.listProgress, currentNumber, opts.kind);

  const consumed = isManga ? opts.listProgress?.chaptersRead : opts.listProgress?.episodesWatched;
  const isAlreadyConsumed =
    currentNumber !== undefined && consumed !== undefined && currentNumber <= consumed;

  const trackingHint =
    currentNumber === undefined
      ? `Le numéro n'a pas été détecté sur cette page. Clique « Modifier » pour reconfigurer la détection sur ce site.`
      : isAlreadyConsumed
        ? `Vous avez déjà ${isManga ? 'lu' : 'vu'} ${ceNumberWord}. Cliquez « ${markBtnLabel} » pour ${isManga ? 'le relire' : 'le relire (rewatch)'}.`
        : opts.mode === 'audio'
          ? `L'épisode que tu regardes sera mis à jour dans ta liste au changement d'épisode, ou immédiatement avec « ${markBtnLabel} ».`
          : `Clique « ${markBtnLabel} » pour mettre à jour ta liste avec ${ceNumberWord}.`;

  const cover = opts.coverUrl
    ? `<img class="cover" data-cover-for="${escapeHtml('badge')}" alt="" />`
    : `<div class="cover-placeholder"></div>`;

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .badge {
        display: flex; flex-direction: column; gap: 10px;
        padding: 12px 14px;
        width: 360px; max-width: calc(100vw - 48px);
        background: #030a1d;
        color: oklch(0.985 0.002 247.839);
        border: 1px solid rgba(60, 90, 166, 0.3);
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(60, 90, 166, 0.15);
        font-family: ${FONT_STACK};
        font-size: 12px; line-height: 1.45;
        animation: slideIn 220ms ease-out;
      }
      @keyframes slideIn { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

      .header { display: flex; gap: 10px; align-items: flex-start; }
      .cover, .cover-placeholder {
        width: 40px; height: 56px; border-radius: 4px; object-fit: cover;
        background: #102866; flex: none;
        border: 1px solid rgba(255, 255, 255, 0.04);
      }
      .info { flex: 1; min-width: 0; }
      .label {
        font-size: 9px; font-weight: 600; letter-spacing: 0.06em;
        text-transform: uppercase;
        color: oklch(66.906% 0.18376 248.826);
        margin-bottom: 3px;
      }
      .title {
        font-weight: 500; font-size: 13px;
        color: oklch(0.985 0.002 247.839);
        line-height: 1.3;
      }
      .episode {
        margin-top: 4px;
        font-size: 11px;
        color: oklch(86.989% 0.06369 262.465);
      }
      .list-progress {
        margin-top: 4px;
        display: inline-block;
        padding: 2px 7px;
        border-radius: 10px;
        background: rgba(60, 90, 166, 0.2);
        border: 1px solid rgba(60, 90, 166, 0.35);
        color: oklch(0.985 0.002 247.839);
        font-size: 10px;
        font-weight: 500;
      }
      .hint {
        font-size: 11px;
        color: oklch(86.989% 0.06369 262.465);
        opacity: 0.85;
      }
      .actions {
        display: flex; gap: 6px;
        padding-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
      }
      button.btn {
        flex: 1; padding: 7px 8px;
        border-radius: 6px;
        font-size: 11px; font-weight: 500;
        cursor: pointer;
        font-family: ${FONT_STACK};
        transition: background 120ms, border-color 120ms;
      }
      button.btn:disabled { opacity: 0.5; cursor: wait; }
      button.btn.primary {
        background: oklch(66.906% 0.18376 248.826);
        color: #030a1d;
        border: 1px solid oklch(66.906% 0.18376 248.826);
        font-weight: 600;
      }
      button.btn.primary:hover { background: oklch(72% 0.18 248.826); }
      button.btn.secondary {
        background: rgba(255, 255, 255, 0.04);
        color: oklch(0.985 0.002 247.839);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      button.btn.secondary:hover { background: rgba(255, 255, 255, 0.08); }
      button.btn.danger {
        background: transparent;
        color: oklch(0.704 0.191 22.216);
        border: 1px solid rgba(248, 113, 113, 0.25);
      }
      button.btn.danger:hover { background: rgba(248, 113, 113, 0.08); border-color: rgba(248, 113, 113, 0.4); }
      button.btn.resume {
        background: rgba(99, 102, 241, 0.12);
        color: oklch(86.989% 0.06369 262.465);
        border: 1px solid rgba(99, 102, 241, 0.35);
        position: relative;
      }
      button.btn.resume:hover { background: rgba(99, 102, 241, 0.2); border-color: rgba(99, 102, 241, 0.55); }
      button.btn.resume .exp {
        position: absolute; top: -5px; right: -5px;
        font-size: 8px; line-height: 1;
        padding: 2px 4px; border-radius: 3px;
        background: oklch(66.906% 0.18376 248.826); color: #030a1d;
        font-weight: 700; letter-spacing: 0.05em;
      }
    </style>
    <div class="badge">
      <div class="header">
        ${cover}
        <div class="info">
          <div class="label">${escapeHtml(labelHeader)}</div>
          <div class="title">${escapeHtml(opts.matchedTitle)}${escapeHtml(seasonHint)}</div>
          <div class="episode">${escapeHtml(epText.charAt(0).toUpperCase() + epText.slice(1))}</div>
          ${listProgressLabel ? `<div class="list-progress">${listProgressLabel}</div>` : ''}
        </div>
      </div>
      <div class="hint">${escapeHtml(trackingHint)}</div>
      ${
        opts.resume
          ? `<div class="actions">
              <button class="btn resume" id="actunime-badge-resume" title="Aller directement ${auNumberWord} ${opts.resume.targetNumber} (fonctionnalité expérimentale)">Reprendre ${auNumberWord} ${opts.resume.targetNumber}<span class="exp">EXP</span></button>
            </div>`
          : ''
      }
      <div class="actions">
        <button class="btn primary" id="actunime-badge-mark"${currentNumber === undefined ? ' disabled' : ''}>${escapeHtml(markBtnLabel)}</button>
        ${
          currentNumber === undefined && opts.onReconfigure
            ? `<button class="btn secondary" id="actunime-badge-reconfigure" title="Relancer l'assistant de configuration">Configurer</button>`
            : `<button class="btn secondary" id="actunime-badge-edit" title="Choisir une autre œuvre">Modifier</button>`
        }
        <button class="btn danger" id="actunime-badge-ignore" title="Ne plus tracker cette série">Ignorer</button>
      </div>
    </div>
  `;
  document.documentElement.appendChild(host);

  const disableAll = () => {
    shadow.querySelectorAll<HTMLButtonElement>('button.btn').forEach((b) => {
      b.disabled = true;
    });
  };

  const wireBtn = (id: string, cb: () => void | Promise<void>) => {
    shadow.querySelector<HTMLButtonElement>(`#${id}`)?.addEventListener('click', async () => {
      disableAll();
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      await cb();
    });
  };
  wireBtn('actunime-badge-mark', opts.onMarkNow);
  wireBtn('actunime-badge-edit', opts.onEdit);
  wireBtn('actunime-badge-ignore', opts.onIgnore);
  if (opts.onReconfigure) {
    wireBtn('actunime-badge-reconfigure', opts.onReconfigure);
  }
  if (opts.resume) {
    wireBtn('actunime-badge-resume', opts.resume.onResume);
  }

  // Auto-dismiss avec hover-pause : le timer est suspendu tant que la souris
  // est sur le badge (laisse le temps de cliquer un bouton).
  const duration = opts.durationMs ?? 7_000;
  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(removeWatchingBadge, duration);
  host.addEventListener('mouseenter', () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  });
  host.addEventListener('mouseleave', () => {
    if (!timeoutId) timeoutId = setTimeout(removeWatchingBadge, duration);
  });

  if (opts.coverUrl) {
    if (opts.coverUrl.startsWith('data:')) {
      const img = shadow.querySelector<HTMLImageElement>('img.cover');
      if (img) img.src = opts.coverUrl;
    } else {
      void (async () => {
        try {
          const res = (await sendMessage({
            type: 'FETCH_IMAGE',
            payload: { url: opts.coverUrl as string },
          })) as FetchImageResultPayload;
          if (res.ok && res.dataUrl) {
            const img = shadow.querySelector<HTMLImageElement>('img.cover');
            if (img) img.src = res.dataUrl;
          }
        } catch {
          // silencieux : fallback placeholder
        }
      })();
    }
  }
}

export function removeWatchingBadge(): void {
  const el = document.getElementById(BADGE_ID);
  if (el) el.remove();
}

export function removeConfigPrompt(): void {
  const el = document.getElementById(CONFIG_PROMPT_ID);
  if (el) el.remove();
}

export function showConfigPrompt(opts: {
  kind: 'anime' | 'manga';
  onConfigure: () => void;
  onDismiss?: () => void;
}): void {
  if (document.getElementById(CONFIG_PROMPT_ID)) return;
  const host = document.createElement('div');
  host.id = CONFIG_PROMPT_ID;
  host.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:2147483645;font-family:${FONT_STACK};`;
  const shadow = host.attachShadow({ mode: 'closed' });

  const isManga = opts.kind === 'manga';
  const headline = isManga
    ? 'Site non configuré pour le suivi de tes mangas'
    : 'Site non configuré pour le suivi de tes animes';
  const body = `Lance l'assistant pour qu'Actunime Sync identifie le titre et ${isManga ? 'le chapitre' : "l'épisode"} sur ce site.`;

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .prompt {
        display: flex; flex-direction: column; gap: 10px;
        padding: 12px 14px;
        width: 320px; max-width: calc(100vw - 48px);
        background: #030a1d;
        color: oklch(0.985 0.002 247.839);
        border: 1px dashed rgba(60, 90, 166, 0.5);
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(60, 90, 166, 0.15);
        font-family: ${FONT_STACK};
        font-size: 12px; line-height: 1.45;
        animation: slideIn 220ms ease-out;
      }
      @keyframes slideIn { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .header { display: flex; align-items: flex-start; gap: 10px; }
      .badge {
        flex-shrink: 0;
        font-size: 10px; padding: 3px 8px; border-radius: 4px;
        background: oklch(66.906% 0.18376 248.826); color: #030a1d;
        font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
      }
      .close {
        margin-left: auto; flex-shrink: 0;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        color: oklch(86.989% 0.06369 262.465);
        cursor: pointer; font-size: 14px; line-height: 1;
        width: 22px; height: 22px; border-radius: 4px;
        display: flex; align-items: center; justify-content: center;
      }
      .close:hover { background: rgba(255, 255, 255, 0.08); }
      .title { font-weight: 600; font-size: 12.5px; }
      .body { color: oklch(86.989% 0.06369 262.465); }
      .actions { display: flex; gap: 6px; padding-top: 4px; }
      button.btn {
        flex: 1; padding: 7px 8px;
        border-radius: 6px;
        font-size: 11px; font-weight: 600;
        cursor: pointer;
        font-family: ${FONT_STACK};
        background: oklch(66.906% 0.18376 248.826);
        color: #030a1d;
        border: 1px solid oklch(66.906% 0.18376 248.826);
        transition: background 120ms;
      }
      button.btn:hover { background: oklch(72% 0.18 248.826); }
    </style>
    <div class="prompt">
      <div class="header">
        <span class="badge">Actunime</span>
        <button class="close" id="actunime-config-prompt-close" aria-label="Fermer">×</button>
      </div>
      <div class="title">${escapeHtml(headline)}</div>
      <div class="body">${escapeHtml(body)}</div>
      <div class="actions">
        <button class="btn" id="actunime-config-prompt-launch">Configurer ce site</button>
      </div>
    </div>
  `;

  shadow.querySelector('#actunime-config-prompt-launch')?.addEventListener('click', () => {
    removeConfigPrompt();
    void opts.onConfigure();
  });
  shadow.querySelector('#actunime-config-prompt-close')?.addEventListener('click', () => {
    removeConfigPrompt();
    opts.onDismiss?.();
  });

  document.documentElement.appendChild(host);
}
