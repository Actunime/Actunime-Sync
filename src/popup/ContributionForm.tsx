/**
 * Mini-formulaire de contribution rapide pour proposer l'ajout d'un anime
 * non encore référencé sur Actunime. L'envoi crée :
 *   1. une `Proposal` (mode CREATION, entityType Anime) côté API
 *   2. une `ListEntry` qui pointe vers cette proposal (l'anime apparaît dans
 *      la liste de l'user immédiatement, statut "en attente de validation")
 *
 * Auto-pré-remplissage :
 *   - titre depuis la détection courante
 *   - cover via og:image / JSON-LD `image` (lu côté page via chrome.scripting),
 *     puis fetch SW pour conversion base64
 *
 * Si l'auto-cover échoue ou n'est pas satisfaisante, fallback upload manuel
 * (input file → FileReader → base64).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AnimeFormatSelection,
  AnimeListStatusArray,
  CountrySelection,
  ListStatusLabels,
  MangaFormatSelection,
  MangaListStatusArray,
  MediaStatusSelection,
} from '@/shared/actunime-constants';
import {
  ArrowLeft,
  ImageOff,
  Loader2,
  MousePointerClick,
  RefreshCw,
  Send,
  Upload,
} from 'lucide-react';
import { storage } from '@/shared/storage';
import {
  sendMessage,
  type ContributeProposeMediaResultPayload,
} from '@/shared/messaging';

interface ContributionFormProps {
  detectedKind?: 'anime' | 'manga';
  detectedTitle: string;
  detectedEpisode?: number;
  detectedChapter?: number;
  onCancel: () => void;
  /** `joinedExisting=true` si une proposition d'un autre user a été rejointe. */
  onSuccess: (joinedExisting: boolean) => void;
}

export function ContributionForm({
  detectedKind = 'anime',
  detectedTitle,
  detectedEpisode,
  detectedChapter,
  onCancel,
  onSuccess,
}: Readonly<ContributionFormProps>) {
  const [kind, setKind] = useState<'anime' | 'manga'>(detectedKind);
  const [title, setTitle] = useState(detectedTitle);
  const [aliasesRaw, setAliasesRaw] = useState('');
  const [format, setFormat] = useState<string>(detectedKind === 'manga' ? 'MANGA' : 'SERIE');
  const [country, setCountry] = useState<string>('JAPAN');
  const [status, setStatus] = useState<string>('AIRING');
  const [listStatus, setListStatus] = useState<string>(
    detectedKind === 'manga' ? 'READING' : 'WATCHING',
  );

  const formatOptions = kind === 'manga' ? MangaFormatSelection : AnimeFormatSelection;
  const listStatusArray = kind === 'manga' ? MangaListStatusArray : AnimeListStatusArray;

  const handleKindChange = (next: 'anime' | 'manga') => {
    if (next === kind) return;
    setKind(next);
    setFormat(next === 'manga' ? 'MANGA' : 'SERIE');
    setListStatus(next === 'manga' ? 'READING' : 'WATCHING');
  };
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const [coverLoading, setCoverLoading] = useState(true);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Auto-détection de l'image au mount (et bouton « rafraîchir »).
  // Le fetch se fait dans le contexte de la page (cookies, Referer, CORS) pour
  // contourner les protections anti-hotlink type 403.
  const detectCover = useCallback(async () => {
    setCoverLoading(true);
    setCoverError(null);
    try {
      const result = await detectAndFetchCoverInPage();
      if (!result.ok) {
        setCoverError(result.error);
        setCoverDataUrl(null);
        return;
      }
      setCoverDataUrl(result.dataUrl);
    } catch (err) {
      setCoverError((err as Error)?.message ?? 'Erreur de récupération de l\'image.');
    } finally {
      setCoverLoading(false);
    }
  }, []);

  useEffect(() => {
    // Au mount : si un pick visuel est en attente (l'user a cliqué « Choisir
    // dans la page », fermé le popup et cliqué une image), on le consomme et
    // on évite de relancer l'auto-détection (qui écraserait la sélection).
    void (async () => {
      const picked = await storage.getPendingImagePickResult();
      if (picked) {
        await storage.setPendingImagePickResult(null);
        setCoverDataUrl(picked);
        setCoverLoading(false);
        setCoverError(null);
        return;
      }
      void detectCover();
    })();
  }, [detectCover]);

  const handlePickInPage = useCallback(async () => {
    setCoverError(null);
    await sendMessage({ type: 'START_IMAGE_PICK' });
    // Le popup se ferme naturellement quand l'user clique dans la page.
    // À sa prochaine ouverture, le useEffect ci-dessus consommera le résultat.
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setCoverError(null);
    if (file.size > 5 * 1024 * 1024) {
      setCoverError('Image trop lourde (max 5 Mo).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') setCoverDataUrl(result);
    };
    reader.onerror = () => setCoverError('Lecture du fichier impossible.');
    reader.readAsDataURL(file);
  }, []);

  const submit = useCallback(async () => {
    setSubmitError(null);
    if (!title.trim()) {
      setSubmitError('Le titre est requis.');
      return;
    }
    if (!coverDataUrl) {
      setSubmitError('Une image de couverture est requise.');
      return;
    }
    setSubmitting(true);
    try {
      const aliases = aliasesRaw
        .split(/[,\n]/)
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
      const res = (await sendMessage({
        type: 'CONTRIBUTE_PROPOSE_MEDIA',
        payload: {
          kind,
          title: title.trim(),
          aliases: aliases.length ? aliases : undefined,
          format,
          country,
          status,
          coverDataUrl,
          episode: detectedEpisode,
          chapter: detectedChapter,
          listStatus,
        },
      })) as ContributeProposeMediaResultPayload;
      if (!res.ok) {
        setSubmitError(res.error);
        setSubmitting(false);
        return;
      }
      onSuccess(res.joinedExisting === true);
    } catch (err) {
      setSubmitError((err as Error)?.message ?? 'Erreur inconnue.');
      setSubmitting(false);
    }
  }, [
    kind,
    title,
    aliasesRaw,
    format,
    country,
    status,
    coverDataUrl,
    detectedEpisode,
    detectedChapter,
    listStatus,
    onSuccess,
  ]);

  return (
    <section className="rounded-md border border-primary/30 bg-primary/5 p-3 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Retour
        </button>
        <span className="text-xs uppercase tracking-wide text-primary font-medium">
          Proposer un ajout
        </span>
      </header>

      <div
        role="tablist"
        aria-label="Type de contenu"
        className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/20 p-1"
      >
        {(['anime', 'manga'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => handleKindChange(k)}
            disabled={submitting}
            className={`rounded text-xs font-medium py-1.5 transition-colors ${
              kind === k
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {k === 'anime' ? 'Anime' : 'Manga'}
          </button>
        ))}
      </div>

      <div className="rounded-md border border-warning/40 bg-warning/5 p-2.5 text-[11px] leading-relaxed text-foreground">
        <strong className="text-warning">Avant de proposer, vérifie d'abord</strong> avec
        la recherche manuelle dans la card de confirmation — ton œuvre existe peut-être
        déjà sous un titre légèrement différent. Si tu la trouves, la sélectionner
        proposera automatiquement ton titre comme synonyme pour aider les autres.
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium">
          Titre <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={submitting}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium">
          Synonymes / titres alternatifs <span className="text-muted-foreground font-normal">(optionnel)</span>
        </label>
        <input
          type="text"
          value={aliasesRaw}
          onChange={(e) => setAliasesRaw(e.target.value)}
          disabled={submitting}
          placeholder="Titre anglais, original, abréviation… séparés par des virgules"
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <p className="text-[10px] text-muted-foreground leading-snug">
          Améliore la détection si d'autres utilisateurs ont des sites avec un titre différent
          pour la même œuvre — moins de doublons à fusionner ensuite.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Format</label>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            disabled={submitting}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            {formatOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Pays</label>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            disabled={submitting}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            {CountrySelection.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Statut de diffusion</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={submitting}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            {MediaStatusSelection.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Dans ta liste</label>
          <select
            value={listStatus}
            onChange={(e) => setListStatus(e.target.value)}
            disabled={submitting}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            {listStatusArray.map((s) => (
              <option key={s} value={s}>
                {ListStatusLabels[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium">
          Image de couverture <span className="text-destructive">*</span>
        </label>
        <CoverPreview
          coverDataUrl={coverDataUrl}
          loading={coverLoading}
          error={coverError}
        />
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={detectCover}
            disabled={coverLoading || submitting}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
          >
            {coverLoading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            Re-détecter
          </button>
          <button
            onClick={handlePickInPage}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            title="Le popup se fermera. Clique sur une image dans la page, puis ré-ouvre l'extension."
          >
            <MousePointerClick className="size-3" />
            Sélecteur
          </button>
          <label className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-2 py-1.5 text-xs hover:bg-muted cursor-pointer">
            <Upload className="size-3" />
            Fichier
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={submitting}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      {submitError && (
        <div className="text-xs text-destructive">{submitError}</div>
      )}

      <button
        onClick={submit}
        disabled={submitting || !title.trim() || !coverDataUrl}
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {submitting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Send className="size-3.5" />
        )}
        Proposer et ajouter à ma liste
      </button>

      <p className="text-[10px] text-muted-foreground leading-snug">
        L'œuvre sera ajoutée à ta liste avec le statut « Planifié » en attendant la
        validation par l'équipe Actunime.
      </p>
    </section>
  );
}

function CoverPreview({
  coverDataUrl,
  loading,
  error,
}: Readonly<{ coverDataUrl: string | null; loading: boolean; error: string | null }>) {
  if (loading) {
    return (
      <div className="h-32 rounded-md border border-dashed border-border flex items-center justify-center bg-muted/20">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (coverDataUrl) {
    return (
      <div className="rounded-md overflow-hidden border border-border bg-muted/20 flex items-center justify-center max-h-40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={coverDataUrl} alt="Aperçu cover" className="max-h-40 object-contain" />
      </div>
    );
  }
  return (
    <div className="h-32 rounded-md border border-dashed border-border flex flex-col items-center justify-center gap-1 bg-muted/20 text-xs text-muted-foreground p-2 text-center">
      <ImageOff className="size-4" />
      <span>{error ?? 'Aucune image. Choisis-en une manuellement.'}</span>
    </div>
  );
}

type CoverFetchResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string };

async function detectAndFetchCoverInPage(): Promise<CoverFetchResult> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return { ok: false, error: 'Onglet introuvable' };
    }
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        // 1) Localise une URL d'image à partir du DOM
        const og = document
          .querySelector<HTMLMetaElement>('meta[property="og:image"]')
          ?.content;
        let url: string | null = og ?? null;
        if (!url) {
          const lds = document.querySelectorAll<HTMLScriptElement>(
            'script[type="application/ld+json"]',
          );
          for (const s of lds) {
            try {
              const parsed = JSON.parse(s.textContent ?? '') as unknown;
              const items = Array.isArray(parsed) ? parsed : [parsed];
              for (const item of items) {
                const img = (item as { image?: unknown }).image;
                if (typeof img === 'string') {
                  url = img;
                  break;
                }
                if (Array.isArray(img) && typeof img[0] === 'string') {
                  url = img[0];
                  break;
                }
                if (img && typeof img === 'object' && 'url' in img) {
                  const u = (img as { url?: unknown }).url;
                  if (typeof u === 'string') {
                    url = u;
                    break;
                  }
                }
              }
              if (url) break;
            } catch {
              // skip invalid JSON-LD
            }
          }
        }
        if (!url) {
          return {
            ok: false as const,
            error: 'Aucune image og:image / ld+json trouvée dans la page.',
          };
        }

        try {
          const target = new URL(url, location.href);
          if (target.protocol !== 'https:' && target.protocol !== 'http:') {
            return { ok: false as const, error: 'Schéma URL non supporté' };
          }
          const sameSite = (() => {
            const a = location.hostname.split('.').slice(-2).join('.');
            const b = target.hostname.split('.').slice(-2).join('.');
            return a === b;
          })();
          if (!sameSite) {
            return {
              ok: false as const,
              error: `Image hors-domaine (${target.hostname}) — bloquée par sécurité.`,
            };
          }
          url = target.toString();
        } catch {
          return { ok: false as const, error: "URL d'image invalide" };
        }

        try {
          const response = await fetch(url, { credentials: 'same-origin' });
          if (response.ok) {
            const blob = await response.blob();
            return await new Promise<
              { ok: true; dataUrl: string } | { ok: false; error: string }
            >((resolve) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({ ok: true as const, dataUrl: reader.result as string });
              reader.onerror = () =>
                resolve({ ok: false as const, error: 'Lecture du blob échouée' });
              reader.readAsDataURL(blob);
            });
          }
        } catch {
          // fall through to canvas strategy
        }

        // 3) Stratégie B : <img> + canvas (échoue si serveur sans CORS)
        return await new Promise<
          { ok: true; dataUrl: string } | { ok: false; error: string }
        >((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const ctx = canvas.getContext('2d');
              if (!ctx) return resolve({ ok: false, error: 'Canvas indisponible' });
              ctx.drawImage(img, 0, 0);
              const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
              resolve({ ok: true, dataUrl });
            } catch (e) {
              resolve({ ok: false, error: (e as Error).message });
            }
          };
          img.onerror = () =>
            resolve({ ok: false, error: 'Image inaccessible (CORS / 403)' });
          img.src = url!;
        });
      },
    });
    return (res?.result as CoverFetchResult) ?? { ok: false, error: 'Pas de réponse' };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? 'Erreur inconnue' };
  }
}
