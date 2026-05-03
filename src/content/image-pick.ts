/**
 * Mode pick visuel pour images : highlight au survol des `<img>` valides
 * (taille raisonnable), clic capture la source et la convertit en base64
 * dans le contexte de la page (cookies, Referer hérités → bypass 403).
 *
 * Le résultat est stocké dans `chrome.storage.local.pendingImagePickResult`
 * que le popup `ContributionForm` consomme à sa prochaine ouverture.
 *
 * Esc pour annuler.
 */

import { storage } from '@/shared/storage';

const HIGHLIGHT_ID = 'actunime-image-pick-highlight';
const TOOLBAR_ID = 'actunime-image-pick-toolbar';
const FONT_STACK =
  "'Outfit Variable', 'Outfit', system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

let pickActive = false;

export function startImagePick(): void {
  if (pickActive) return;
  pickActive = true;

  const highlight = document.createElement('div');
  highlight.id = HIGHLIGHT_ID;
  highlight.style.cssText = `
    position: fixed; pointer-events: none; z-index: 2147483646;
    border: 3px solid oklch(66.906% 0.18376 248.826);
    background: oklch(66.906% 0.18376 248.826 / 0.15);
    border-radius: 4px;
    transition: all 50ms ease-out;
    display: none;
  `;
  document.documentElement.appendChild(highlight);

  const toolbar = document.createElement('div');
  toolbar.id = TOOLBAR_ID;
  toolbar.style.cssText = `
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    z-index: 2147483647;
    background: #030a1d; color: #fafafa;
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
    <span>Clique sur l'image de couverture dans la page.</span>
    <button id="actunime-image-pick-cancel" style="margin-left: 8px; padding: 4px 10px; background: rgba(255, 255, 255, 0.06); color: #fafafa; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 4px; font-size: 11px; cursor: pointer; font-family: ${FONT_STACK};">Annuler (Esc)</button>
  `;
  document.documentElement.appendChild(toolbar);

  toolbar
    .querySelector<HTMLButtonElement>('#actunime-image-pick-cancel')
    ?.addEventListener('click', () => cleanup());

  const onMove = (e: MouseEvent) => {
    const target = imageUnderPoint(e.clientX, e.clientY);
    if (!target) {
      highlight.style.display = 'none';
      return;
    }
    const rect = target.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  };

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    const target = imageUnderPoint(e.clientX, e.clientY);
    if (!target) return;
    void capture(target);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    }
  };

  const cleanup = () => {
    pickActive = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    highlight.remove();
    toolbar.remove();
  };

  const capture = async (img: HTMLImageElement) => {
    cleanup();
    try {
      const dataUrl = await imageToDataUrl(img);
      if (!dataUrl) {
        console.warn('[Actunime] Image inaccessible (CORS / 403).');
        return;
      }
      await storage.setPendingImagePickResult(dataUrl);
    } catch (err) {
      console.warn('[Actunime] Échec capture image:', err);
    }
  };

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}

/**
 * Cherche l'`<img>` sous le curseur, en remontant éventuellement les enfants
 * d'un wrapper. Filtre les images trop petites (icônes < 60×60).
 */
function imageUnderPoint(x: number, y: number): HTMLImageElement | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  if (el.id === HIGHLIGHT_ID || el.id === TOOLBAR_ID) return null;
  if (el instanceof HTMLImageElement) return validateImage(el) ? el : null;
  // Si on survole un wrapper qui contient une image visible, on la prend
  if (el instanceof HTMLElement) {
    const inner = el.querySelector('img');
    if (inner instanceof HTMLImageElement && validateImage(inner)) return inner;
  }
  return null;
}

function validateImage(img: HTMLImageElement): boolean {
  const rect = img.getBoundingClientRect();
  if (rect.width < 60 || rect.height < 60) return false;
  if (!img.src && !img.srcset) return false;
  return true;
}

/**
 * Convertit un `<img>` chargé en data URL base64 via canvas. Si le serveur
 * d'origine n'envoie pas les headers CORS, le canvas est tainted et
 * `toDataURL` throw — fallback vers fetch direct (avec credentials de la page).
 */
async function imageToDataUrl(img: HTMLImageElement): Promise<string | null> {
  // Stratégie A : canvas direct (l'image est déjà chargée, donc pas de re-fetch)
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    // canvas tainted — fallback fetch
  }

  try {
    const response = await fetch(img.src, { credentials: 'same-origin' });
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
