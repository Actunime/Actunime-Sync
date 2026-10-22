/**
 * Mini-formulaire d'ajout rapide pour une œuvre non encore référencée sur Actunime (E124). L'envoi appelle
 * `POST /lists/quick-add` : l'API crée (ou rejoint) une proposition « Ajout rapide » et l'entrée de liste
 * correspondante (visible de l'utilisateur seul tant que l'équipe n'a pas créé la fiche). Titre, type et format
 * suffisent : le pays est déduit du format côté API, l'équipe complète le reste.
 */

import { useCallback, useState } from 'react';
import {
  AnimeFormatSelection,
  AnimeListStatusArray,
  ListStatusLabels,
  MangaFormatSelection,
  MangaListStatusArray,
} from '@/shared/actunime-constants';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import { sendMessage, type ContributeProposeMediaResultPayload } from '@/shared/messaging';

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
  const [format, setFormat] = useState<string>(detectedKind === 'manga' ? 'MANGA' : 'SERIE');
  const [listStatus, setListStatus] = useState<string>(
    detectedKind === 'manga' ? 'READING' : 'WATCHING',
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const formatOptions = kind === 'manga' ? MangaFormatSelection : AnimeFormatSelection;
  const listStatusArray = kind === 'manga' ? MangaListStatusArray : AnimeListStatusArray;

  const handleKindChange = (next: 'anime' | 'manga') => {
    if (next === kind) return;
    setKind(next);
    setFormat(next === 'manga' ? 'MANGA' : 'SERIE');
    setListStatus(next === 'manga' ? 'READING' : 'WATCHING');
  };

  const submit = useCallback(async () => {
    setSubmitError(null);
    if (!title.trim()) {
      setSubmitError('Le titre est requis.');
      return;
    }
    setSubmitting(true);
    try {
      const res = (await sendMessage({
        type: 'CONTRIBUTE_PROPOSE_MEDIA',
        payload: {
          kind,
          title: title.trim(),
          format,
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
  }, [kind, title, format, detectedEpisode, detectedChapter, listStatus, onSuccess]);

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
          Ajout rapide
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
        <strong className="text-warning">Avant de proposer, vérifie d'abord</strong> avec la
        recherche manuelle dans la card de confirmation — ton œuvre existe peut-être déjà sous un
        titre légèrement différent. Si tu la trouves, la sélectionner proposera automatiquement ton
        titre comme synonyme pour aider les autres.
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

      {submitError && <div className="text-xs text-destructive">{submitError}</div>}

      <button
        onClick={submit}
        disabled={submitting || !title.trim()}
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        Proposer et ajouter à ma liste
      </button>

      <p className="text-[10px] text-muted-foreground leading-snug">
        L'œuvre est ajoutée à ta liste (visible de toi seul) en attendant que l'équipe Actunime crée
        sa fiche.
      </p>
    </section>
  );
}
