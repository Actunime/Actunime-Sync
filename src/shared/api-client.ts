/**
 * Mini-client REST Actunime pour l'extension. Pas de Socket.io, pas de queue de
 * retry : juste fetch + Bearer token + erreurs typées. Remplace volontairement
 * `@actunime/client` (trop lourd à cause de socket.io-client ~40 KB gzipped).
 */

import { storage } from "./storage";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

import { API_URL } from "./config";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  auth?: boolean; // true = include Bearer token from storage
  signal?: AbortSignal;
}

/**
 * Statut spécial pour les erreurs réseau (DNS, serveur down, timeout) qui ne
 * passent pas par une réponse HTTP. `ApiError.status === 0` signale ce cas.
 */
export const API_NETWORK_ERROR_STATUS = 0;

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, auth = true, signal } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (auth) {
    const authState = await storage.getAuth();
    if (authState) {
      headers.Authorization = `Bearer ${authState.accessToken}`;
    }
  }

  let response: Response;
  try {
    response = await fetch(
      `${API_URL}${path.startsWith("/") ? path : `/${path}`}`,
      {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal,
      },
    );
  } catch (err) {
    // `TypeError: Failed to fetch` → DNS, serveur down, mixed content, CORS rejet.
    // `AbortError` → timeout user (signal abort).
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(
        API_NETWORK_ERROR_STATUS,
        "Requête annulée",
        undefined,
      );
    }
    throw new ApiError(
      API_NETWORK_ERROR_STATUS,
      "Serveur Actunime inaccessible",
      { cause: (err as Error)?.message },
    );
  }

  if (!response.ok) {
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
    const message =
      (data as { message?: string })?.message ??
      `HTTP ${response.status} ${response.statusText}`;

    // Expiration du token : nettoyage auto côté extension.
    if (response.status === 401 && auth) {
      await storage.clearAuth();
    }

    throw new ApiError(response.status, message, data);
  }

  if (response.status === 204) return undefined as unknown as T;
  return (await response.json()) as T;
}

export interface PendingProposal {
  id?: string;
  _id?: string;
  mainDependency?: {
    title?: { original?: string; alias?: string[] };
    poster?: { url?: string; file?: string };
  };
  supportCount?: number;
}

export interface SearchMedia {
  /** L'API NestJS expose `id` (virtual Mongoose). `_id` reste possible si raw. */
  id?: string;
  _id?: string;
  title?: { original?: string; normal?: string; alias?: string[] };
  /** URL absolue du poster, virtual Mongoose (`AnimeSchema.virtual('posterUrl')`). */
  posterUrl?: string | null;
  bannerUrl?: string | null;
  /** Form alternative si `populate('poster')` a été appelé en amont. */
  cover?: { url?: string } | null;
  date?: { start?: string | Date | null } | null;
  externs?: { AL_ID?: number; MAL_ID?: number; KITSU_ID?: number };
}

export interface ListEntry {
  id?: string;
  _id?: string;
  mediaType: "Anime" | "Manga";
  /** Vide quand l'entry pointe vers une proposition en attente. */
  mediaId?: string | null;
  proposalId?: string | null;
  /** Preview embarqué quand `mediaId` n'existe pas encore (proposal pending). */
  preview?: { title: string; coverImage?: string } | null;
  /** Populated quand l'API utilise `populate('proposal')`. */
  proposal?: { supportCount?: number } | null;
  status: string;
  episodesWatched?: number;
  volumesRead?: number;
  chaptersRead?: number;
  score?: number;
  rewatchCount?: number;
}

/** Helper : retourne l'ID effectif quel que soit le schéma de l'API. */
export function entityId(
  e: { id?: string; _id?: string } | null | undefined,
): string | undefined {
  return e?.id ?? e?._id;
}

export const api = {
  /**
   * Ping `/maintenance/health/public` pour vérifier la disponibilité de l'API.
   * L'endpoint `/maintenance/health` complet est protégé staff — on utilise
   * la variante publique qui ne réclame pas de JWT (bypass `JwtAuthGuard`
   * global via `@Public()` côté API).
   *
   * Retourne `true` si HTTP 200, `false` sinon (network error ou 5xx). Ne
   * throw pas — utilisé par le popup pour afficher un bandeau « API down ».
   */
  async checkHealth(): Promise<boolean> {
    try {
      await request<unknown>("/maintenance/health/public", { auth: false });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Échange un code one-time contre un JWT d'extension. Endpoint public.
   */
  exchangeExtensionCode(code: string) {
    return request<{
      accessToken: string;
      expiresIn: number;
      user: {
        id: string;
        memberId: string;
        username: string;
        displayName?: string;
        avatarUrl?: string | null;
        roles: string[];
      };
    }>("/auth/extension/exchange", {
      method: "POST",
      body: { code },
      auth: false,
    });
  },

  /**
   * Révoque le token d'extension courant.
   */
  revokeToken(jti: string) {
    return request<{ success: boolean }>(`/auth/extension/tokens/${jti}`, {
      method: "DELETE",
    });
  },

  /**
   * Recherche fuzzy multi-entités. Retourne top N animes/mangas/... matchant le terme.
   */
  /**
   * Recherche fuzzy par titre, scoped à l'entité (anime ou manga).
   * Utilise `POST /animes` ou `POST /mangas` avec `query.search`. Plus efficace
   * que la recherche multi-entités sur les sites avec un seul kind.
   */
  searchByKind(kind: "anime" | "manga", search: string, limit = 10) {
    const path = kind === "manga" ? "/mangas" : "/animes";
    console.log(`[Actunime] searchByKind ${kind} ${search} ${limit}`);
    return request<{
      results?: SearchMedia[];
      data?: SearchMedia[];
    }>(path, {
      method: "POST",
      body: { query: { search }, limit, page: 1 },
    }).then((res) => res.results ?? res.data ?? []);
  },

  /**
   * Recherche les propositions PENDING (CREATION) qui matchent un titre — pour
   * que l'extension propose à l'user de rejoindre une proposition existante
   * avant d'en créer une nouvelle.
   */
  searchPendingProposals(kind: "anime" | "manga", search: string, limit = 5) {
    const entityType = kind === "manga" ? "Manga" : "Anime";
    console.log(`[Actunime] searchPendingProposals ${kind} ${search} ${limit}`);
    return request<{
      results?: PendingProposal[];
      data?: PendingProposal[];
    }>("/proposals/paginate", {
      method: "POST",
      body: {
        query: {
          search,
          status: "PENDING",
          mode: "CREATION",
          entityType,
        },
        limit,
        page: 1,
      },
    }).then((res) => {
      console.log(`[Actunime] res`, res);
      return res.results ?? res.data ?? [];
    });
  },

  /**
   * Récupère la list entry du user courant pour un média (anime/manga) donné.
   * 404 si pas d'entrée existante.
   */
  getListByMedia(mediaId: string) {
    return request<ListEntry>(`/lists/by-media/${mediaId}`);
  },

  /**
   * Liste les entrées « en attente » (proposition pas encore validée).
   * Utilisé par le matcher pour reconnaître une œuvre déjà proposée par
   * l'user sans repasser par `/search/global`.
   */
  getPendingListEntries() {
    return request<ListEntry[]>("/lists/pending");
  },

  /**
   * Met à jour une list entry existante.
   */
  updateListEntry(
    id: string,
    patch: Partial<
      Pick<
        ListEntry,
        "episodesWatched" | "chaptersRead" | "status" | "rewatchCount"
      >
    >,
  ) {
    return request<ListEntry>(`/lists/${id}`, {
      method: "PUT",
      body: patch,
    });
  },

  /**
   * Crée une nouvelle list entry pour un média.
   */
  createListEntry(body: {
    mediaId: string;
    mediaType: "Anime" | "Manga";
    status?: string;
    episodesWatched?: number;
    chaptersRead?: number;
  }) {
    const defaultStatus = body.mediaType === "Manga" ? "READING" : "WATCHING";
    return request<ListEntry>("/lists/create", {
      method: "POST",
      body: { status: defaultStatus, ...body },
    });
  },

  /**
   * Supprime une list entry (utilisé pour annuler un push qui avait créé une
   * nouvelle entrée).
   */
  deleteListEntry(id: string) {
    return request<void>(`/lists/${id}`, { method: "DELETE" });
  },

  /**
   * Cherche une proposition d'ajout PENDING par titre normalisé.
   * Retourne `{ id }` si une existe, `null` sinon.
   */
  findPendingAnimeProposal(title: string) {
    return request<{ id: string } | null>(
      `/proposals/find-pending-anime?title=${encodeURIComponent(title)}`,
    );
  },

  findPendingMangaProposal(title: string) {
    return request<{ id: string } | null>(
      `/proposals/find-pending-manga?title=${encodeURIComponent(title)}`,
    );
  },

  /**
   * Crée une proposition d'ajout (mode CREATION) pour un anime ou un manga.
   * Retourne `{ id }` du proposal créé.
   *
   * Note : le service Proposal côté API itère directement sur
   * `body.dependencies` / `body.mediaRelations` / etc. sans nullish-check —
   * on doit envoyer ces tableaux vides explicitement.
   */
  createAnimeProposal(body: {
    title: { original: string; alias?: string[] };
    country: string;
    format: string;
    status: string;
    poster: { file: string; type: string };
  }) {
    return request<{ id: string }>("/proposals", {
      method: "POST",
      body: {
        mode: "CREATION",
        entityType: "Anime",
        mainDependency: body,
        dependencies: [],
        mediaRelations: [],
        characterLinks: [],
        images: [],
      },
    });
  },

  createMangaProposal(body: {
    title: { original: string; alias?: string[] };
    country: string;
    format: string;
    status: string;
    poster: { file: string; type: string };
  }) {
    return request<{ id: string }>("/proposals", {
      method: "POST",
      body: {
        mode: "CREATION",
        entityType: "Manga",
        mainDependency: body,
        dependencies: [],
        mediaRelations: [],
        characterLinks: [],
        images: [],
      },
    });
  },

  /**
   * Crée une list entry pointant vers une proposition en attente.
   */
  createListEntryFromProposal(body: {
    proposalId: string;
    mediaType: "Anime" | "Manga";
    status?: string;
    preview: { title: string; coverImage?: string };
    episodesWatched?: number;
    chaptersRead?: number;
  }) {
    return request<ListEntry>("/lists/from-proposal", {
      method: "POST",
      body,
    });
  },
};
