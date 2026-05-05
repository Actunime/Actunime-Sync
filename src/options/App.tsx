import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Download,
  Globe,
  Loader2,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  sendMessage,
  type ListActivatedHostsResultPayload,
  type ListLearnedPatternsResultPayload,
} from '@/shared/messaging';
import type { LearnedPattern, StrategyId } from '@/shared/types';
import {
  diffImport,
  parseLearnedPatternsExport,
  serializePatterns,
  suggestFilename,
  type ImportDiff,
} from '@/shared/learned-patterns-io';

interface ActivatedHostRow {
  host: string;
  activatedAt: number;
}

export function App() {
  return (
    <main className="min-h-screen max-w-3xl mx-auto p-8 flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold">Actunime Sync — Paramètres</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gère les sites où l'extension est active et tes préférences de tracking.
        </p>
      </header>
      <ActivatedHostsSection />
      <LearnedPatternsSection />
    </main>
  );
}

const STRATEGY_LABELS: Record<StrategyId, string> = {
  jsonld: 'JSON-LD (données structurées)',
  og: 'Open Graph (meta tags)',
  'url-tokens': "Tokens dans l'URL",
  'document-title': 'Titre de la page',
  'dom-selectors': 'Sélecteurs DOM génériques',
  manual: 'Manuelle (sélecteurs CSS pointés)',
};

function LearnedPatternsSection() {
  const [patterns, setPatterns] = useState<LearnedPattern[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = (await sendMessage({
      type: 'LIST_LEARNED_PATTERNS',
    })) as ListLearnedPatternsResultPayload;
    setPatterns(res.patterns.sort((a, b) => (b.updatedAt < a.updatedAt ? -1 : 1)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Synchronise si l'user retire un pattern depuis le popup pendant la consultation.
  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !('learnedPatterns' in changes)) return;
      void refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [refresh]);

  const handleRemove = useCallback(
    async (host: string) => {
      setRemoving(host);
      try {
        await sendMessage({ type: 'REMOVE_LEARNED_PATTERN', payload: { host } });
        await refresh();
      } finally {
        setRemoving(null);
      }
    },
    [refresh],
  );

  const handleExportSingle = useCallback((p: LearnedPattern) => {
    downloadJson(serializePatterns([p]), suggestFilename([p]));
  }, []);

  const handleExportAll = useCallback(() => {
    if (!patterns || patterns.length === 0) return;
    downloadJson(serializePatterns(patterns), suggestFilename(patterns));
  }, [patterns]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Sites configurés</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Patterns d'apprentissage créés via l'assistant de configuration. Stockés uniquement sur
            ton ordinateur — jamais transmis à Actunime.
          </p>
        </div>
        {patterns && patterns.length > 0 && (
          <button
            onClick={handleExportAll}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            <Download className="size-3.5" />
            Exporter tout ({patterns.length})
          </button>
        )}
      </div>

      {patterns === null && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {patterns && patterns.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Aucune configuration personnalisée. Sur un site supporté, ouvre le popup et clique «
          Configurer ce site » pour lancer l'assistant.
        </div>
      )}

      {patterns && patterns.length > 0 && (
        <ul className="flex flex-col gap-2">
          {patterns.map((p) => (
            <li
              key={p.host}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Settings2 className="size-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{p.host}</div>
                  <div className="text-xs text-muted-foreground">
                    {STRATEGY_LABELS[p.strategy] ?? p.strategy} · configuré le{' '}
                    {new Date(p.createdAt).toLocaleDateString('fr-FR')}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleExportSingle(p)}
                  title="Exporter ce site en JSON"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-transparent px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <Download className="size-3.5" />
                  Exporter
                </button>
                <button
                  onClick={() => handleRemove(p.host)}
                  disabled={removing === p.host}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-transparent px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
                >
                  {removing === p.host ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  Retirer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ImportLearnedPatterns existing={patterns ?? []} onImported={refresh} />
    </section>
  );
}

function downloadJson(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Libère l'URL après que le navigateur ait eu le temps de lancer le download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface ImportPreview {
  raw: LearnedPattern[];
  diff: ImportDiff;
}

function ImportLearnedPatterns({
  existing,
  onImported,
}: Readonly<{ existing: LearnedPattern[]; onImported: () => void | Promise<void> }>) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setSuccess(null);
      setPreview(null);
      const text = await file.text();
      const parsed = parseLearnedPatternsExport(text);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const diff = diffImport(parsed.patterns, existing);
      setPreview({ raw: parsed.patterns, diff });
    },
    [existing],
  );

  const handlePaste = useCallback(
    async (text: string) => {
      setError(null);
      setSuccess(null);
      setPreview(null);
      if (text.trim().length === 0) return;
      const parsed = parseLearnedPatternsExport(text);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const diff = diffImport(parsed.patterns, existing);
      setPreview({ raw: parsed.patterns, diff });
    },
    [existing],
  );

  const handleConfirm = useCallback(async () => {
    if (!preview) return;
    setImporting(true);
    try {
      // Save sequentially — chaque save passe par le SW (msg) qui écrit dans
      // chrome.storage. On pourrait paralléliser mais l'ordre garantit qu'en
      // cas d'échec partiel l'user voit où ça a coincé.
      for (const p of preview.raw) {
        await sendMessage({
          type: 'SAVE_LEARNED_PATTERN',
          payload: { pattern: p },
        });
      }
      const total = preview.raw.length;
      setSuccess(`${total} configuration${total > 1 ? 's' : ''} importée${total > 1 ? 's' : ''}.`);
      setPreview(null);
      await onImported();
    } catch (err) {
      setError(`Erreur d'import : ${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  }, [preview, onImported]);

  const handleCancel = useCallback(() => {
    setPreview(null);
    setError(null);
  }, []);

  return (
    <div className="rounded-md border border-border bg-muted/10 p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Upload className="size-4 text-muted-foreground" />
          Importer une configuration
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Charge un fichier <code>.json</code> exporté par toi ou par un autre utilisateur. Les
          sites déjà configurés seront remplacés par la version importée.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Upload className="size-3.5" />
          Charger un fichier
        </button>
        <button
          onClick={async () => {
            try {
              const text = await navigator.clipboard.readText();
              await handlePaste(text);
            } catch {
              setError('Impossible de lire le presse-papier.');
            }
          }}
          disabled={importing}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          Coller depuis le presse-papier
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
          <AlertCircle className="size-3.5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-2.5 text-xs text-success">
          <Check className="size-3.5 flex-shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {preview && (
        <div className="rounded-md border border-border bg-card p-3 flex flex-col gap-2">
          <p className="text-xs font-medium">
            Prêt à importer {preview.raw.length} configuration
            {preview.raw.length > 1 ? 's' : ''} :
          </p>
          <ul className="text-xs text-muted-foreground space-y-1 max-h-40 overflow-y-auto">
            {preview.diff.fresh.map((p) => (
              <li key={p.host} className="flex items-center gap-2">
                <Check className="size-3 text-success flex-shrink-0" />
                <span className="truncate">
                  <strong className="text-foreground">{p.host}</strong> — nouveau
                </span>
              </li>
            ))}
            {preview.diff.conflicts.map((p) => (
              <li key={p.host} className="flex items-center gap-2">
                <AlertCircle className="size-3 text-amber-500 flex-shrink-0" />
                <span className="truncate">
                  <strong className="text-foreground">{p.host}</strong> — remplacera la version
                  actuelle
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleConfirm}
              disabled={importing}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {importing && <Loader2 className="size-3.5 animate-spin" />}
              Confirmer l'import
            </button>
            <button
              onClick={handleCancel}
              disabled={importing}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-transparent px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivatedHostsSection() {
  const [hosts, setHosts] = useState<ActivatedHostRow[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = (await sendMessage({
      type: 'LIST_ACTIVATED_HOSTS',
    })) as ListActivatedHostsResultPayload;
    setHosts(res.hosts.sort((a, b) => b.activatedAt - a.activatedAt));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRemove = useCallback(
    async (host: string) => {
      setRemoving(host);
      try {
        await sendMessage({ type: 'DEACTIVATE_HOST', payload: { host } });
        await refresh();
      } finally {
        setRemoving(null);
      }
    },
    [refresh],
  );

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Sites activés</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Sites où tu as autorisé Actunime à lire les pages pour détecter ce que tu regardes. Les
          sites listés dans le manifest (Crunchyroll, ADN, Netflix, Prime, Disney+) sont actifs par
          défaut et n'apparaissent pas ici.
        </p>
      </div>

      {hosts === null && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {hosts && hosts.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Aucun site activé manuellement. Visite un site de streaming non couvert et clique «
          Activer Actunime sur ce site » dans le popup pour l'ajouter.
        </div>
      )}

      {hosts && hosts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {hosts.map((row) => (
            <li
              key={row.host}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Globe className="size-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{row.host}</div>
                  <div className="text-xs text-muted-foreground">
                    Activé le {new Date(row.activatedAt).toLocaleDateString('fr-FR')}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleRemove(row.host)}
                disabled={removing === row.host}
                className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-transparent px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
              >
                {removing === row.host ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
