import { useEffect, useState } from 'react';
import { storage } from '@/shared/storage';
import {
  AlertCircle,
  ArrowUpCircle,
  BookOpen,
  Check,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  ImageOff,
  List,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  Settings2,
  ThumbsUp,
  Trash2,
  User,
  Wand2,
} from 'lucide-react';
import { ContributionForm } from './ContributionForm';
import { useApiHealth } from './hooks/useApiHealth';
import { useAuth } from './hooks/useAuth';
import { useConfigWizard } from './hooks/useConfigWizard';
import { useCurrentDetection } from './hooks/useCurrentDetection';
import { useMatchedAnime } from './hooks/useMatchedAnime';
import { useSiteActivation } from './hooks/useSiteActivation';
import { useTrackingState } from './hooks/useTrackingState';
import { useUpdateInfo } from './hooks/useUpdateInfo';
import { launchAuthFlow, logout, AuthFlowError } from '@/shared/auth-flow';
import { WEB_URL } from '@/shared/config';
import type { DetectionStatusPayload } from '@/shared/messaging';

function openWebUrl(path: string) {
  void chrome.tabs.create({ url: `${WEB_URL}${path}` });
}

export function App() {
  const { auth, loading, refresh } = useAuth();
  const [actionState, setActionState] = useState<'idle' | 'signing-in' | 'signing-out' | 'error'>(
    'idle',
  );
  const [errorMessage, setErrorMessage] = useState('');

  // Demande de contribution venue de la card in-page (overlay) : on pré-charge
  // le form au lieu d'afficher le popup normal. Consommée à submit/annul.
  const [pendingContribution, setPendingContribution] =
    useState<Awaited<ReturnType<typeof storage.getPendingContribution>>>(null);
  const [pendingChecked, setPendingChecked] = useState(false);
  const [pendingSuccess, setPendingSuccess] = useState<{
    kind: 'anime' | 'manga';
    joinedExisting: boolean;
  } | null>(null);
  useEffect(() => {
    void (async () => {
      const pending = await storage.getPendingContribution();
      setPendingContribution(pending);
      setPendingChecked(true);
    })();
  }, []);
  const clearPending = async () => {
    await storage.clearPendingContribution();
    setPendingContribution(null);
    // Retire le badge `!` posé par le SW à l'arrivée du pending
    try {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: 'Actunime Sync' });
    } catch {
      // ignore
    }
  };

  const handleSignIn = async () => {
    setActionState('signing-in');
    setErrorMessage('');
    try {
      await launchAuthFlow();
      await refresh();
      setActionState('idle');
    } catch (err) {
      const message =
        err instanceof AuthFlowError ? err.message : ((err as Error)?.message ?? 'Erreur inconnue');
      setErrorMessage(message);
      setActionState('error');
    }
  };

  const handleSignOut = async () => {
    setActionState('signing-out');
    try {
      await logout();
      await refresh();
      setActionState('idle');
    } catch {
      setActionState('idle');
    }
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <img
          src={chrome.runtime.getURL('public/icons/icon-48.png')}
          alt="Actunime"
          className="size-8 rounded-md"
        />
        <div className="flex-1">
          <h1 className="text-base font-semibold">Actunime Sync</h1>
          <p className="text-xs text-muted-foreground">v{chrome.runtime.getManifest().version}</p>
        </div>
      </header>

      <UpdateBanner />
      <ApiHealthBanner />

      {loading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && !auth && (
        <section className="flex flex-col gap-3">
          <div className="text-sm text-muted-foreground">
            Synchronise tes épisodes vus sur les sites de streaming compatibles avec ta liste
            Actunime.
          </div>
          <button
            onClick={handleSignIn}
            disabled={actionState === 'signing-in'}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
          >
            {actionState === 'signing-in' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogIn className="size-4" />
            )}
            Se connecter à Actunime
          </button>
          {actionState === 'error' && errorMessage && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              <AlertCircle className="size-3.5 flex-shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </section>
      )}

      {!loading && auth && pendingChecked && pendingContribution && !pendingSuccess && (
        <section className="flex flex-col gap-3">
          <ContributionForm
            detectedKind={pendingContribution.kind}
            detectedTitle={pendingContribution.title}
            detectedEpisode={pendingContribution.episode}
            detectedChapter={pendingContribution.chapter}
            onCancel={() => {
              void clearPending();
            }}
            onSuccess={(joinedExisting) => {
              setPendingSuccess({
                kind: pendingContribution.kind ?? 'anime',
                joinedExisting,
              });
              void clearPending();
            }}
          />
        </section>
      )}

      {!loading && auth && pendingSuccess && (
        <ContributionSuccessCard
          kind={pendingSuccess.kind}
          joinedExisting={pendingSuccess.joinedExisting}
          onClose={() => {
            setPendingSuccess(null);
            window.close();
          }}
        />
      )}

      {!loading && auth && pendingChecked && !pendingContribution && (
        <section className="flex flex-col gap-3">
          <button
            onClick={() => openWebUrl('/profile')}
            className="group flex items-center gap-3 rounded-md border border-border bg-muted/20 hover:bg-muted/40 p-3 text-left transition-colors"
          >
            {auth.user.avatarUrl ? (
              <img src={auth.user.avatarUrl} alt="" className="size-10 rounded-full object-cover" />
            ) : (
              <div className="size-10 rounded-full bg-muted flex items-center justify-center">
                <User className="size-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {auth.user.displayName ?? auth.user.username}
              </p>
              <p className="text-xs text-muted-foreground truncate">@{auth.user.username}</p>
            </div>
            <ExternalLink className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </button>

          <div className="grid grid-cols-2 gap-2">
            <QuickAction
              icon={List}
              label="Mes animes"
              onClick={() => openWebUrl('/profile/animes')}
            />
            <QuickAction
              icon={BookOpen}
              label="Mes mangas"
              onClick={() => openWebUrl('/profile/mangas')}
            />
            <QuickAction
              icon={ThumbsUp}
              label="Propositions"
              onClick={() => openWebUrl('/propositions')}
            />
            <QuickAction icon={Globe} label="Découvrir" onClick={() => openWebUrl('/')} />
          </div>

          <CurrentDetectionCard />

          <SiteActivationCard />

          <SiteConfigWizardCard />

          <button
            onClick={handleSignOut}
            disabled={actionState === 'signing-out'}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-transparent px-4 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {actionState === 'signing-out' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <LogOut className="size-3.5" />
            )}
            Se déconnecter
          </button>
        </section>
      )}

      <footer className="text-xs text-muted-foreground pt-2 border-t">
        <a
          href={chrome.runtime.getURL('src/options/index.html')}
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          Paramètres & sites supportés
        </a>
      </footer>
    </div>
  );
}

function UpdateBanner() {
  const info = useUpdateInfo();
  if (!info?.available) return null;
  const handleOpen = () => {
    if (info.releaseUrl) void chrome.tabs.create({ url: info.releaseUrl });
  };
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <ArrowUpCircle className="size-4 text-primary flex-shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed">
          <strong className="text-foreground">Mise à jour disponible</strong>{' '}
          <span className="text-muted-foreground">
            Actunime Sync {info.latestVersion} est sortie. La version actuelle ne se met pas à jour
            automatiquement — télécharge la nouvelle version pour profiter des dernières
            améliorations.
          </span>
        </div>
      </div>
      <button
        onClick={handleOpen}
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Télécharger la mise à jour
      </button>
    </div>
  );
}

interface IQuickActionProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}

function QuickAction({ icon: Icon, label, onClick }: Readonly<IQuickActionProps>) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-transparent hover:bg-muted px-2 py-1.5 text-xs font-medium transition-colors"
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

interface IContributionSuccessCardProps {
  kind: 'anime' | 'manga';
  joinedExisting: boolean;
  onClose: () => void;
}

function ContributionSuccessCard({
  kind,
  joinedExisting,
  onClose,
}: Readonly<IContributionSuccessCardProps>) {
  const listPath = kind === 'manga' ? '/profile/mangas' : '/profile/animes';
  const itemWord = kind === 'manga' ? 'manga' : 'anime';
  const message = joinedExisting
    ? `Un autre utilisateur avait déjà proposé cet ${itemWord} — tu rejoins sa proposition. ` +
      `L'œuvre est maintenant dans ta liste, vous validerez ensemble.`
    : `Ta proposition est envoyée. L'${itemWord} est ajouté à ta liste en attendant la validation par l'équipe Actunime.`;
  return (
    <section className="rounded-md border border-success/40 bg-success/5 p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="size-5 text-success flex-shrink-0 mt-0.5" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-foreground">
            {joinedExisting ? 'Proposition existante rejointe' : 'Proposition envoyée'}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">{message}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => openWebUrl(listPath)}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ExternalLink className="size-3.5" />
          Voir ma liste
        </button>
        <button
          onClick={onClose}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-3 py-2 text-xs font-medium hover:bg-muted"
        >
          Fermer
        </button>
      </div>
    </section>
  );
}

function SiteActivationCard() {
  const { host, state, canActivate, activating, activate, lastResult } = useSiteActivation();

  if (!host || !canActivate || state === null) return null;

  if (state === 'activated') {
    return (
      <div className="rounded-md border border-success/30 bg-success/5 p-2 flex items-center gap-2 text-xs">
        <Check className="size-3.5 text-success flex-shrink-0" />
        <span className="text-muted-foreground">
          Actif sur <strong className="text-foreground">{host}</strong>
        </span>
      </div>
    );
  }

  // state === 'inactive'
  return (
    <div className="rounded-md border border-border bg-muted/10 p-3 flex flex-col gap-2.5">
      <div className="flex items-start gap-2">
        <Globe className="size-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed">
          Ajoute <strong className="text-foreground">{host}</strong> à ta liste de sites suivis.
          L'assistant de configuration s'ouvrira directement après pour identifier le titre et le
          numéro dans la page.
        </div>
      </div>
      <button
        onClick={activate}
        disabled={activating}
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {activating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        Ajouter et configurer ce site
      </button>
      {lastResult?.denied && (
        <p className="text-xs text-amber-500 flex items-center gap-1">
          <AlertCircle className="size-3" />
          Permission refusée. Réessaie pour autoriser.
        </p>
      )}
      {lastResult && !lastResult.ok && lastResult.error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="size-3" />
          {lastResult.error}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground leading-snug">
        Chrome te demandera l'autorisation. Tu peux la révoquer à tout moment depuis les paramètres
        de l'extension.
      </p>
    </div>
  );
}

function CurrentDetectionCard() {
  const { detection, loading } = useCurrentDetection();

  if (loading) {
    return (
      <div className="rounded-md border border-border bg-muted/10 p-3 flex items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detection?.detected) {
    return (
      <div className="rounded-md border border-border bg-muted/10 p-3 flex items-start gap-2 text-xs">
        <EyeOff className="size-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="text-muted-foreground">
          Aucune série détectée sur cet onglet. Ouvre un épisode sur un site configuré.
        </div>
      </div>
    );
  }

  return <DetectedAnimeCard detection={detection} />;
}

/**
 * Carte affichée quand une page épisode est détectée. Combine :
 * - infos brutes du content script (titre extrait du site, numéro d'épisode)
 * - résolution vers l'entité Actunime (poster, titre officiel, année)
 * - barre de progression live
 */
function DetectedAnimeCard({
  detection,
}: Readonly<{ detection: Extract<DetectionStatusPayload, { detected: true }> }>) {
  const { match, loading: matchLoading } = useMatchedAnime(detection);
  const { state: tracking, marking, markAsWatched } = useTrackingState();
  const [contributing, setContributing] = useState(false);
  const [contributedFlash, setContributedFlash] = useState<null | 'created' | 'joined'>(null);
  const [markedFlash, setMarkedFlash] = useState<'idle' | 'ok' | 'error'>('idle');

  const handleMarkAsWatched = async () => {
    const res = await markAsWatched();
    if (res?.ok) {
      setMarkedFlash('ok');
      setTimeout(() => setMarkedFlash('idle'), 3_000);
    } else {
      setMarkedFlash('error');
      setTimeout(() => setMarkedFlash('idle'), 3_000);
    }
  };

  const matchedTitle = match?.matched ? match.media.title : null;
  const matchedYear = match?.matched ? match.media.year : null;
  const matchedCover = match?.matched ? match.media.coverUrl : null;
  const isPending = match?.matched === true && match.media.isPending === true;
  const pendingSupportCount =
    isPending && match?.matched === true ? match.media.supportCount : undefined;
  const notInActunime = !matchLoading && match?.matched === false;

  // Le flow contribution est inline (mini-form dans le popup) — plus de
  // redirection vers Actunime-Web. Voir `ContributionForm.tsx`.
  if (contributing) {
    return (
      <ContributionForm
        detectedKind={detection.kind}
        detectedTitle={detection.title}
        detectedEpisode={detection.episode}
        detectedChapter={detection.chapter}
        onCancel={() => setContributing(false)}
        onSuccess={(joinedExisting) => {
          setContributing(false);
          setContributedFlash(joinedExisting ? 'joined' : 'created');
        }}
      />
    );
  }

  if (contributedFlash) {
    return (
      <ContributionSuccessCard
        kind={detection.kind}
        joinedExisting={contributedFlash === 'joined'}
        onClose={() => setContributedFlash(null)}
      />
    );
  }

  const isManga = detection.kind === 'manga';

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Eye className="size-4 text-primary flex-shrink-0" />
        <p className="text-xs uppercase tracking-wide text-primary font-medium">
          {isManga ? 'En cours de lecture' : 'En cours de visionnage'}
        </p>
      </div>

      <div className="flex gap-3">
        <AnimePoster src={matchedCover} loading={matchLoading} />

        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <p className="text-sm font-medium leading-tight" title={matchedTitle ?? detection.title}>
            {matchedTitle ?? detection.title}
          </p>

          {matchedYear && !isPending && (
            <p className="text-xs text-muted-foreground">{matchedYear}</p>
          )}

          {isPending && (
            <div className="flex flex-col gap-0.5">
              <p className="text-xs text-amber-500 flex items-center gap-1">
                <CircleHelp className="size-3" />
                En attente de validation
              </p>
              {typeof pendingSupportCount === 'number' && pendingSupportCount > 1 && (
                <p className="text-[10px] text-muted-foreground">
                  {pendingSupportCount} utilisateurs suivent cette proposition
                </p>
              )}
            </div>
          )}

          {!matchedTitle && !matchLoading && match?.matched === false && (
            <p className="text-xs text-amber-500 flex items-center gap-1">
              <CircleHelp className="size-3" />
              Pas dans Actunime
            </p>
          )}

          {(isManga ? detection.chapter : detection.episode) !== undefined && (
            <p className="text-xs text-muted-foreground mt-auto">
              {isManga ? `Chapitre ${detection.chapter}` : `Épisode ${detection.episode}`}
              {!isManga && detection.season !== undefined ? ` · Saison ${detection.season}` : ''}
            </p>
          )}
        </div>
      </div>

      {notInActunime ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground leading-snug">
            Cette œuvre n'est pas (encore) référencée sur Actunime. Propose-la pour qu'elle soit
            ajoutée et trackée à l'avenir.
          </p>
          <button
            onClick={() => setContributing(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary/15 border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25"
          >
            <Plus className="size-3.5" />
            Proposer son ajout
          </button>
        </div>
      ) : matchedTitle ? (
        <TrackingFooter
          kind={detection.kind}
          mode={tracking?.mode ?? null}
          engagementReached={!!tracking?.engagementReached}
          cumulativeMs={tracking?.cumulativeMs ?? 0}
          marking={marking}
          markedFlash={markedFlash}
          onMarkAsWatched={handleMarkAsWatched}
        />
      ) : (
        <p className="text-xs text-muted-foreground italic">Recherche en cours…</p>
      )}
    </div>
  );
}

function TrackingFooter({
  kind,
  mode,
  engagementReached,
  cumulativeMs,
  marking,
  markedFlash,
  onMarkAsWatched,
}: Readonly<{
  kind: 'anime' | 'manga';
  mode: 'audio' | 'manual' | null;
  engagementReached: boolean;
  cumulativeMs: number;
  marking: boolean;
  markedFlash: 'idle' | 'ok' | 'error';
  onMarkAsWatched: () => void | Promise<void>;
}>) {
  const isManga = kind === 'manga';
  const itemWord = isManga ? 'chapitre' : 'épisode';
  const consumedVerb = isManga ? 'lu' : 'vu';
  const markBtnLabel = `Marquer ce ${itemWord} comme ${consumedVerb}`;

  if (markedFlash === 'ok') {
    return (
      <p className="text-xs text-success flex items-center gap-1.5">
        <CheckCircle2 className="size-3.5" />
        {`${isManga ? 'Chapitre' : 'Épisode'} marqué ${consumedVerb} sur Actunime.`}
      </p>
    );
  }
  if (markedFlash === 'error') {
    return (
      <p className="text-xs text-destructive flex items-center gap-1.5">
        <AlertCircle className="size-3.5" />
        Échec du marquage. Réessaie dans un instant.
      </p>
    );
  }

  if (isManga || mode === 'manual') {
    return (
      <button
        onClick={onMarkAsWatched}
        disabled={marking}
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-success/15 border border-success/40 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/25 disabled:opacity-50"
      >
        {marking ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="size-3.5" />
        )}
        {markBtnLabel}
      </button>
    );
  }

  if (mode === 'audio') {
    const minutes = Math.floor(cumulativeMs / 60_000);
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Tracking via audio · {minutes} min cumulées</p>
        {engagementReached ? (
          <button
            onClick={onMarkAsWatched}
            disabled={marking}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-success/15 border border-success/40 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/25 disabled:opacity-50"
          >
            {marking ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            {markBtnLabel}
          </button>
        ) : (
          <p className="text-[10px] text-muted-foreground italic">
            L'épisode sera marqué vu automatiquement. Pour anticiper, le bouton apparaîtra après ~10
            min.
          </p>
        )}
      </div>
    );
  }

  return <p className="text-xs text-muted-foreground italic">En attente de la lecture…</p>;
}

/**
 * Bandeau d'avertissement quand l'API Actunime ne répond pas. Visible dès que
 * le popup s'ouvre (premier ping immédiat) et auto-refresh toutes les 30 s.
 */
function ApiHealthBanner() {
  const { status, recheck } = useApiHealth();
  if (status !== 'down') return null;
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="size-4 text-destructive flex-shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed">
          <strong className="text-destructive">Serveur Actunime indisponible.</strong>{' '}
          <span className="text-muted-foreground">
            Vérifie ta connexion ou réessaie dans quelques instants. Le tracking ne marchera pas
            tant que le serveur ne répond pas.
          </span>
        </div>
      </div>
      <button
        onClick={recheck}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-destructive/30 bg-transparent px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
      >
        Réessayer
      </button>
    </div>
  );
}

function SiteConfigWizardCard() {
  const { host, state } = useSiteActivation();
  const { pattern, loading, launchWizard, removePattern } = useConfigWizard(host);
  const [removing, setRemoving] = useState(false);

  if (!host || loading) return null;
  if (state !== 'activated') return null;

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await removePattern();
    } finally {
      setRemoving(false);
    }
  };

  if (pattern) {
    return (
      <div className="rounded-md border border-border bg-muted/10 p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs">
          <Settings2 className="size-3.5 text-muted-foreground" />
          <span className="font-medium text-muted-foreground">Configuration personnalisée</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Stratégie active :{' '}
          <strong className="text-foreground">{strategyLabel(pattern.strategy)}</strong>. Détection
          sur <strong className="text-foreground">{host}</strong>.
        </p>
        <div className="flex gap-2">
          <button
            onClick={launchWizard}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-xs font-medium hover:bg-muted/70"
          >
            <Wand2 className="size-3.5" />
            Reconfigurer
          </button>
          <button
            onClick={handleRemove}
            disabled={removing}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-destructive/30 bg-transparent px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {removing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            Retirer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="size-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed">
          <strong className="text-foreground">Site non configuré.</strong>{' '}
          <span className="text-muted-foreground">
            La détection automatique peut être imprécise sur{' '}
            <strong className="text-foreground">{host}</strong>. Lance l'assistant pour choisir la
            bonne stratégie ou pointer toi-même les éléments du DOM.
          </span>
        </div>
      </div>
      <button
        onClick={launchWizard}
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Wand2 className="size-3.5" />
        Configurer ce site
      </button>
      <p className="text-[10px] text-muted-foreground leading-snug">
        La configuration reste sur ton ordinateur. Tu peux la partager via Export/Import depuis les
        paramètres.
      </p>
    </div>
  );
}

function strategyLabel(strategy: string): string {
  switch (strategy) {
    case 'jsonld':
      return 'JSON-LD';
    case 'og':
      return 'Open Graph';
    case 'url-tokens':
      return 'URL tokens';
    case 'document-title':
      return 'Titre de la page';
    case 'dom-selectors':
      return 'Sélecteurs DOM';
    case 'manual':
      return 'Manuelle';
    default:
      return strategy;
  }
}

function AnimePoster({ src, loading }: Readonly<{ src?: string | null; loading: boolean }>) {
  const [errored, setErrored] = useState(false);
  const showImage = !loading && !!src && !errored;

  return (
    <div className="size-16 rounded-md bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden relative">
      {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {!loading && (!src || errored) && <ImageOff className="size-5 text-muted-foreground" />}
      {showImage && (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover"
          onError={() => setErrored(true)}
        />
      )}
    </div>
  );
}
