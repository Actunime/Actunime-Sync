/**
 * Service worker de l'extension. Écoute les messages entrants depuis les
 * content scripts et le popup, route vers les handlers dédiés.
 *
 * Conserve la dernière `ProgressUpdatePayload` reçue par onglet pour pouvoir
 * pousser au moment où l'user confirme dans le toast (le content script renvoie
 * juste l'action, pas tout le payload).
 */

import type {
  ExtensionMessage,
  MatchResultPayload,
  ProgressUpdatePayload,
  ResearchResultPayload,
  SuggestAliasResultPayload,
} from "@/shared/messaging";
import { storage } from "@/shared/storage";
import {
  handleConfirm,
  handleDiscovery,
  handleProgressUpdate,
  handleResearch,
  handleUndoLastPush,
} from "./tracker";
import { matchTitle, pickDisplayTitle } from "./matcher";
import { api, entityId } from "@/shared/api-client";
import { API_URL, WEB_URL } from "@/shared/config";
import { setupUpdateChecker } from "./update-checker";

setupUpdateChecker();

console.info("[Actunime] Background service worker started");

const lastDetectionByTab = new Map<number, ProgressUpdatePayload>();

/**
 * État de tracking courant par tab — alimenté par le content script (top frame)
 * via `REPORT_TRACKING_STATE` et lu par le popup pour décider d'afficher ou
 * non le bouton « Marquer cet épisode comme vu » (mode A du E14).
 */
interface TrackingState {
  mode: "audio" | "manual" | null;
  engagementReached: boolean;
  cumulativeMs: number;
  confirmed: boolean;
  title?: string;
}
const trackingStateByTab = new Map<number, TrackingState>();

function getContentScriptJs(): string[] {
  const manifest = chrome.runtime.getManifest();
  return manifest.content_scripts?.[0]?.js ?? [];
}

/**
 * (Ré-)enregistre le content script principal pour un host activé. Idempotent
 * (skip si déjà enregistré). Appelé à l'install, au startup, et à chaque
 * activation user via le popup.
 */
async function registerContentScriptForHost(host: string): Promise<void> {
  const id = `actunime-host-${host}`;
  const matches = [`https://${host}/*`];
  const js = getContentScriptJs();
  if (js.length === 0) return;

  // Cleanup d'une éventuelle inscription orpheline avec le même id avant
  // de ré-inscrire (évite « duplicate id » au reload du SW).
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch {
    // ignore : pas inscrit, c'est OK
  }
  try {
    await chrome.scripting.registerContentScripts([
      {
        id,
        js,
        matches,
        runAt: "document_idle",
        allFrames: false,
      },
    ]);
    console.info(`[Actunime] Content script enregistré pour ${host}`);
  } catch (err) {
    console.warn(`[Actunime] Échec enregistrement ${host}:`, err);
  }
}

async function unregisterContentScriptForHost(host: string): Promise<void> {
  const id = `actunime-host-${host}`;
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch {
    // ignore
  }
}

/**
 * Au startup du SW (reboot Chrome ou recharge extension), ré-enregistre tous
 * les content scripts des hosts activés. `chrome.scripting.registerContentScripts`
 * ne survit pas aux reboots → la source de vérité est `storage.activatedHosts`.
 */
async function reregisterAllActivatedHosts(): Promise<void> {
  const activated = await storage.getActivatedHosts();
  const hosts = Object.keys(activated);
  if (hosts.length === 0) return;
  console.info(`[Actunime] Re-registering ${hosts.length} activated hosts…`);
  await Promise.all(hosts.map(registerContentScriptForHost));
}

chrome.runtime.onInstalled.addListener((details) => {
  console.info("[Actunime] Extension installed:", details.reason);
  void reregisterAllActivatedHosts();
});

chrome.runtime.onStartup.addListener(() => {
  void reregisterAllActivatedHosts();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastDetectionByTab.delete(tabId);
  trackingStateByTab.delete(tabId);
});

/**
 * Suit l'état audio de chaque onglet. Permet aux content scripts du top frame
 * de détecter qu'une lecture vidéo est en cours dans une iframe cross-origin
 * sans avoir besoin d'accéder au `<video>` (Chrome reporte le son au niveau
 * onglet). Utilisé en fallback du timing 85 % via `<video>` direct.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.audible === undefined && changeInfo.mutedInfo === undefined)
    return;

  void (async () => {
    const url = tab.url;
    if (!url) return;
    let host: string;
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") return;
      host = u.hostname;
    } catch {
      return;
    }
    const activated = await storage.getActivatedHosts();
    if (!activated[host]) return;

    const audible = !!tab.audible && !tab.mutedInfo?.muted;
    void chrome.tabs
      .sendMessage(
        tabId,
        { type: "TAB_AUDIBLE_CHANGED", payload: { audible } },
        { frameId: 0 },
      )
      .catch(() => {
        // top frame pas injecté sur cet onglet → ignore
      });
  })();
});

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function validateImageUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "URL invalide" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: `Schéma non supporté : ${parsed.protocol}` };
  }
  const apiOrigin = new URL(API_URL).origin;
  const webOrigin = new URL(WEB_URL).origin;
  if (parsed.origin === apiOrigin || parsed.origin === webOrigin) {
    return { ok: true, url: parsed.toString() };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^fe80::/i.test(host) ||
    /^fc[0-9a-f]{2}:/i.test(host)
  ) {
    return { ok: false, error: "Host privé/local refusé" };
  }
  return { ok: true, url: parsed.toString() };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  return `data:${blob.type || "image/jpeg"};base64,${base64}`;
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;

    if (message.type === "DISCOVER_SERIES") {
      (async () => {
        const auth = await storage.getAuth();
        if (!auth) {
          sendResponse({ state: "error", error: "Non connecté à Actunime" });
          return;
        }
        if (sender.tab?.id !== undefined) {
          lastDetectionByTab.set(sender.tab.id, message.payload);
        }
        const result = await handleDiscovery(message.payload);
        sendResponse(result);
      })();
      return true;
    }

    if (message.type === "PROGRESS_UPDATE") {
      (async () => {
        const auth = await storage.getAuth();
        if (!auth) {
          sendResponse({ success: false, error: "Non connecté à Actunime" });
          return;
        }
        if (sender.tab?.id !== undefined) {
          lastDetectionByTab.set(sender.tab.id, message.payload);
        }
        const result = await handleProgressUpdate(message.payload);
        sendResponse(result);
      })();
      return true;
    }

    if (message.type === "CONFIRM_TRACK") {
      (async () => {
        const auth = await storage.getAuth();
        if (!auth) {
          sendResponse({ success: false, error: "Non connecté à Actunime" });
          return;
        }
        const tabId = sender.tab?.id;
        const lastDetection =
          tabId !== undefined ? lastDetectionByTab.get(tabId) : undefined;
        const result = await handleConfirm(message.payload, { lastDetection });
        sendResponse(result);
        console.log("[Actunime] CONFIRM_TRACK", result);
      })();
      return true;
    }

    if (message.type === "RESEARCH_QUERY") {
      (async () => {
        const auth = await storage.getAuth();
        if (!auth) {
          const res: ResearchResultPayload = {
            candidates: [],
            error: "Non connecté",
          };
          sendResponse(res);
          return;
        }
        const result = await handleResearch(
          message.payload.query,
          message.payload.kind,
        );
        sendResponse(result);
      })();
      return true;
    }

    if (message.type === "SUGGEST_ALIAS") {
      (async () => {
        const auth = await storage.getAuth();
        if (!auth) {
          const res: SuggestAliasResultPayload = {
            ok: false,
            error: "Non connecté",
          };
          sendResponse(res);
          return;
        }
        // Stub V0.2 : endpoint API à créer (POST /animes/:id/suggest-alias)
        // qui crée une proposal de modification ne touchant que `title.alias`.
        // Pour l'instant : log + retour ok pour valider le wiring UX côté toast.
        const res: SuggestAliasResultPayload = {
          ok: false,
          error: "Endpoint pas encore implémenté",
        };
        sendResponse(res);
      })();
      return true;
    }

    if (message.type === "REPORT_TRACKING_STATE") {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return false;
      trackingStateByTab.set(tabId, message.payload);
      return false;
    }

    if (message.type === "GET_TRACKING_STATE_FOR_TAB") {
      const state = trackingStateByTab.get(message.payload.tabId);
      sendResponse(
        state ?? {
          mode: null,
          engagementReached: false,
          cumulativeMs: 0,
          confirmed: false,
        },
      );
      return true;
    }

    if (message.type === "UNDO_LAST_PUSH") {
      (async () => {
        const auth = await storage.getAuth();
        if (!auth) {
          sendResponse({ ok: false, error: "Non connecté" });
          return;
        }
        const result = await handleUndoLastPush(message.payload);
        sendResponse(result);
      })();
      return true;
    }

    if (message.type === "MARK_AS_WATCHED_NOW") {
      // Relai vers le top frame qui a le `currentDetection` + audioObserver.
      (async () => {
        const tabId = sender.tab?.id ?? (await activeTabId());
        if (tabId === undefined) {
          sendResponse({ ok: false, error: "Onglet introuvable" });
          return;
        }
        try {
          const res = await chrome.tabs.sendMessage(
            tabId,
            { type: "MARK_AS_WATCHED_NOW" },
            { frameId: 0 },
          );
          sendResponse(res ?? { ok: true });
        } catch (err) {
          sendResponse({
            ok: false,
            error: (err as Error)?.message ?? "no-receiver",
          });
        }
      })();
      return true;
    }

    if (message.type === "QUERY_TAB_AUDIBLE") {
      (async () => {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          sendResponse({ audible: false });
          return;
        }
        try {
          const tab = await chrome.tabs.get(tabId);
          const audible = !!tab.audible && !tab.mutedInfo?.muted;
          sendResponse({ audible });
        } catch {
          sendResponse({ audible: false });
        }
      })();
      return true;
    }

    if (message.type === "CHECK_HOST_STATE") {
      (async () => {
        const host = message.payload.host;
        const activated = await storage.getActivatedHosts();
        sendResponse({
          state: activated[host] ? "activated" : "inactive",
          host,
        });
      })();
      return true;
    }

    if (message.type === "ACTIVATE_HOST") {
      (async () => {
        const host = message.payload.host;
        let granted = false;
        try {
          granted = await chrome.permissions.request({
            origins: [`https://${host}/*`],
          });
        } catch (err) {
          sendResponse({
            ok: false,
            error: (err as Error)?.message ?? "permission denied",
          });
          return;
        }
        if (!granted) {
          sendResponse({ ok: false, denied: true });
          return;
        }
        await storage.addActivatedHost(host);
        await registerContentScriptForHost(host);
        await storage.setPendingWizardForHost(host);

        const tabId = sender.tab?.id ?? (await activeTabId());
        if (tabId !== undefined) {
          await chrome.tabs.reload(tabId);
          const onComplete = (
            updatedTabId: number,
            info: chrome.tabs.TabChangeInfo,
          ) => {
            if (updatedTabId !== tabId || info.status !== "complete") return;
            chrome.tabs.onUpdated.removeListener(onComplete);
            setTimeout(() => {
              void chrome.tabs
                .sendMessage(
                  tabId,
                  { type: "LAUNCH_CONFIG_WIZARD" },
                  { frameId: 0 },
                )
                .catch(() => {
                  // content script pas encore attaché — le flag pendingWizardForHost
                  // sera consommé par maybeAutoLaunchWizard au boot.
                });
            }, 500);
          };
          chrome.tabs.onUpdated.addListener(onComplete);
          setTimeout(
            () => chrome.tabs.onUpdated.removeListener(onComplete),
            15_000,
          );
        }

        sendResponse({ ok: true });
      })();
      return true;
    }

    if (message.type === "DEACTIVATE_HOST") {
      (async () => {
        const host = message.payload.host;
        await unregisterContentScriptForHost(host);
        await storage.removeActivatedHost(host);
        try {
          await chrome.permissions.remove({ origins: [`https://${host}/*`] });
        } catch {
          // si la permission est issue d'un required host, on ne peut pas la retirer
        }
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (message.type === "LIST_ACTIVATED_HOSTS") {
      (async () => {
        const activated = await storage.getActivatedHosts();
        const hosts = Object.entries(activated).map(([host, v]) => ({
          host,
          activatedAt: v.activatedAt,
        }));
        sendResponse({ hosts });
      })();
      return true;
    }

    if (message.type === "LAUNCH_CONFIG_WIZARD") {
      // Relai depuis le popup vers le content script du top frame de l'onglet actif.
      (async () => {
        const tabId = sender.tab?.id ?? (await activeTabId());
        if (tabId === undefined) {
          sendResponse({ ok: false, error: "Onglet introuvable" });
          return;
        }
        try {
          const res = await chrome.tabs.sendMessage(
            tabId,
            { type: "LAUNCH_CONFIG_WIZARD" },
            { frameId: 0 },
          );
          sendResponse(
            res ?? { ok: false, error: "Pas de réponse du content script" },
          );
        } catch (err) {
          sendResponse({
            ok: false,
            error: (err as Error)?.message ?? "no-receiver",
          });
        }
      })();
      return true;
    }

    if (message.type === "SAVE_LEARNED_PATTERN") {
      (async () => {
        try {
          await storage.setLearnedPattern(message.payload.pattern);
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({
            ok: false,
            error: (err as Error)?.message ?? "save failed",
          });
        }
      })();
      return true;
    }

    if (message.type === "REMOVE_LEARNED_PATTERN") {
      (async () => {
        try {
          await storage.removeLearnedPattern(message.payload.host);
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({
            ok: false,
            error: (err as Error)?.message ?? "remove failed",
          });
        }
      })();
      return true;
    }

    if (message.type === "LIST_LEARNED_PATTERNS") {
      (async () => {
        const patterns = await storage.listLearnedPatterns();
        sendResponse({ patterns });
      })();
      return true;
    }

    if (message.type === "GET_LEARNED_PATTERN") {
      (async () => {
        const pattern = await storage.getLearnedPattern(message.payload.host);
        sendResponse({ pattern });
      })();
      return true;
    }

    if (message.type === "FORGET_MATCH") {
      (async () => {
        await storage.forgetMatch(message.payload.seriesKey);
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (message.type === "OPEN_CONTRIBUTION_TAB") {
      (async () => {
        try {
          const path =
            message.payload.kind === "anime"
              ? "/contribute/anime/new"
              : "/contribute/manga/new";
          const url = new URL(`${WEB_URL}${path}`);
          url.searchParams.set("from", "extension");
          if (message.payload.title)
            url.searchParams.set("title", message.payload.title);
          if (message.payload.season !== undefined)
            url.searchParams.set("season", String(message.payload.season));
          if (message.payload.episode !== undefined)
            url.searchParams.set("episode", String(message.payload.episode));
          if (message.payload.sourceUrl)
            url.searchParams.set("sourceUrl", message.payload.sourceUrl);
          await chrome.tabs.create({ url: url.toString() });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({
            ok: false,
            error: (err as Error)?.message ?? "failed to open tab",
          });
        }
      })();
      return true;
    }

    if (message.type === "FETCH_IMAGE") {
      (async () => {
        try {
          const validation = validateImageUrl(message.payload.url);
          if (!validation.ok) {
            sendResponse({ ok: false, error: validation.error });
            return;
          }
          const res = await fetch(validation.url);
          if (!res.ok) {
            sendResponse({ ok: false, error: `HTTP ${res.status}` });
            return;
          }
          // Limite de taille (5 Mo) pour éviter de remplir la mémoire SW.
          const contentLength = res.headers.get("content-length");
          if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) {
            sendResponse({ ok: false, error: "Image trop lourde (> 5 Mo)" });
            return;
          }
          const blob = await res.blob();
          if (blob.size > 5 * 1024 * 1024) {
            sendResponse({ ok: false, error: "Image trop lourde (> 5 Mo)" });
            return;
          }
          const dataUrl = await blobToDataUrl(blob);
          sendResponse({ ok: true, dataUrl });
        } catch (err) {
          sendResponse({
            ok: false,
            error: (err as Error)?.message ?? "fetch failed",
          });
        }
      })();
      return true;
    }

    if (message.type === "START_IMAGE_PICK") {
      // Relai du popup vers le top frame de l'onglet actif. Le content script
      // active un overlay qui highlight les <img> au survol.
      (async () => {
        const tabId = await activeTabId();
        if (tabId === undefined) {
          sendResponse({ ok: false, error: "Onglet introuvable" });
          return;
        }
        try {
          await chrome.tabs.sendMessage(
            tabId,
            { type: "START_IMAGE_PICK" },
            { frameId: 0 },
          );
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({
            ok: false,
            error: (err as Error)?.message ?? "no-receiver",
          });
        }
      })();
      return true;
    }

    if (message.type === "OPEN_CONTRIBUTION_FORM") {
      (async () => {
        try {
          await storage.setPendingContribution({
            kind: message.payload.kind,
            title: message.payload.title,
            episode: message.payload.episode,
            chapter: message.payload.chapter,
            season: message.payload.season,
            sourceUrl: message.payload.sourceUrl,
            requestedAt: Date.now(),
          });
          // Badge visuel sur l'icône pour signaler à l'user qu'il y a quelque
          // chose à finaliser. Effacé dès que le popup consomme le pending.
          try {
            await chrome.action.setBadgeText({ text: "!" });
            await chrome.action.setBadgeBackgroundColor({ color: "#3c5aa6" });
            await chrome.action.setTitle({
              title: "Actunime — Proposition à finaliser",
            });
          } catch {
            // ignore
          }
          // Tente d'ouvrir le popup directement (Chrome 127+ permet
          // `chrome.action.openPopup` depuis le SW dans le contexte d'un
          // user gesture relayé via message). Échoue silencieusement sinon —
          // l'user verra le badge et le toast.
          try {
            await chrome.action.openPopup();
          } catch {
            // openPopup n'est pas garanti — fallback : badge + toast
          }
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({
            ok: false,
            error: (err as Error)?.message ?? "erreur",
          });
        }
      })();
      return true;
    }

    if (message.type === "CONTRIBUTE_PROPOSE_MEDIA") {
      (async () => {
        const auth = await storage.getAuth();
        if (!auth) {
          sendResponse({ ok: false, error: "Non connecté à Actunime" });
          return;
        }
        try {
          const {
            kind,
            title,
            aliases,
            format,
            country,
            status,
            coverDataUrl,
            listStatus,
          } = message.payload;
          const mediaType = kind === "manga" ? "Manga" : "Anime";
          const findPending =
            kind === "manga"
              ? api.findPendingMangaProposal
              : api.findPendingAnimeProposal;
          const createProposal =
            kind === "manga"
              ? api.createMangaProposal
              : api.createAnimeProposal;
          const defaultListStatus = kind === "manga" ? "READING" : "WATCHING";
          const cleanAliases = (aliases ?? [])
            .map((a) => a.trim())
            .filter(
              (a) => a.length > 0 && a.toLowerCase() !== title.toLowerCase(),
            );
          const titleBody = cleanAliases.length
            ? { original: title, alias: cleanAliases }
            : { original: title };

          let proposalId: string;
          let joinedExisting = false;
          try {
            const existing = await findPending(title);
            if (existing?.id) {
              proposalId = existing.id;
              joinedExisting = true;
            } else {
              const created = await createProposal({
                title: titleBody,
                country,
                format,
                status,
                poster: { file: coverDataUrl, type: "POSTER" },
              });
              proposalId = created.id;
            }
          } catch {
            const created = await createProposal({
              title: titleBody,
              country,
              format,
              status,
              poster: { file: coverDataUrl, type: "POSTER" },
            });
            proposalId = created.id;
          }

          const entry = await api.createListEntryFromProposal({
            proposalId,
            mediaType,
            status: listStatus ?? defaultListStatus,
            preview: { title, coverImage: coverDataUrl },
            episodesWatched:
              kind === "anime" ? message.payload.episode : undefined,
            chaptersRead:
              kind === "manga" ? message.payload.chapter : undefined,
          });
          const listEntryId =
            (entry as { id?: string; _id?: string }).id ??
            (entry as { _id?: string })._id ??
            "";
          sendResponse({ ok: true, proposalId, listEntryId, joinedExisting });
        } catch (err) {
          const msg =
            err && typeof err === "object" && "message" in err
              ? String((err as { message: unknown }).message)
              : "Erreur inconnue";
          sendResponse({ ok: false, error: msg });
        }
      })();
      return true;
    }

    if (message.type === "CHECK_API_HEALTH") {
      (async () => {
        const ok = await api.checkHealth();
        sendResponse({ ok });
      })();
      return true;
    }

    if (message.type === "AUTH_PING") {
      (async () => {
        const auth = await storage.getAuth();
        sendResponse({ authenticated: !!auth });
      })();
      return true;
    }

    if (message.type === "MATCH_BY_DETECTION") {
      (async () => {
        const auth = await storage.getAuth();
        if (!auth) {
          const res: MatchResultPayload = {
            matched: false,
            reason: "not_authenticated",
          };
          sendResponse(res);
          return;
        }
        try {
          const result = await matchTitle(message.payload);

          if (result.pending) {
            const res: MatchResultPayload = {
              matched: true,
              score: 1,
              media: {
                id: result.pending.listEntryId,
                title: result.pending.title,
                coverUrl: result.pending.coverUrl ?? null,
                year: null,
                isPending: true,
                supportCount: result.pending.supportCount,
              },
            };
            sendResponse(res);
            return;
          }

          if (result.cached) {
            const res: MatchResultPayload = {
              matched: true,
              score: 1,
              media: {
                id: result.cached.mediaId,
                title: result.cached.title,
                coverUrl: result.cached.coverUrl ?? null,
                year: null,
              },
            };
            sendResponse(res);
            return;
          }

          const top = result.candidates[0];
          if (!top) {
            const res: MatchResultPayload = {
              matched: false,
              reason: "no_match",
            };
            sendResponse(res);
            return;
          }
          const m = top.media;
          const start = m.date?.start;
          const year =
            start instanceof Date
              ? start.getFullYear()
              : typeof start === "string"
                ? new Date(start).getFullYear() || null
                : null;
          const id = entityId(m);
          if (!id) {
            sendResponse({
              matched: false,
              reason: "error",
              error: "Média sans id",
            });
            return;
          }
          const res: MatchResultPayload = {
            matched: true,
            score: top.score,
            media: {
              id,
              title: pickDisplayTitle(m) ?? message.payload.title,
              alias: m.title?.alias,
              coverUrl: m.posterUrl ?? m.cover?.url ?? null,
              year: Number.isFinite(year) ? year : null,
              externs: m.externs,
            },
          };
          sendResponse(res);
        } catch (err) {
          const res: MatchResultPayload = {
            matched: false,
            reason: "error",
            error: (err as Error)?.message ?? "Erreur matching",
          };
          sendResponse(res);
        }
      })();
      return true;
    }

    return false;
  },
);
