// ─── Streamer Hub — Stream Control Panel (Phase 3) ─────────────────────────
// Permet au streamer de piloter sa diffusion Twitch depuis Nodyx :
//   - updateChannelInfo() : PATCH /channels (titre + catégorie)
//   - searchGames()       : GET   /games (autocomplete catégorie)
//   - createMarker()      : POST  /streams/markers (marker VOD pendant live)
//
// Toutes les opérations utilisent le user access token du streamer (scope
// channel:manage:broadcast). Si le scope manque (vieille connexion OAuth),
// hasManageBroadcastScope() permet au frontend de prompt un reconnect.

import { findPrimaryStreamer, getDecryptedTokens, refreshAndPersist } from './tokenService'
import { twitchProvider } from './providers/twitchProvider'
import { invalidateTwitchProfileCache } from './twitchProfile'

const TWITCH_HELIX  = 'https://api.twitch.tv/helix'
const MANAGE_SCOPE  = 'channel:manage:broadcast'

// Truncate Unicode-safe : .slice() sur une string JS opère sur les UTF-16
// code units, ce qui peut couper un emoji (surrogate pair) en deux et
// produire une string invalide. Array.from découpe par code point, ce qui
// préserve les emojis simples (👋, 🎮, …). Pour les emojis composés
// (👨‍👩‍👧‍👦, drapeaux, ZWJ sequences), il faudrait Intl.Segmenter mais le
// risque résiduel est limité : Twitch valide de son côté la longueur réelle.
function safeTruncate(s: string, maxCodePoints: number): string {
  const chars = Array.from(s)
  return chars.length <= maxCodePoints ? s : chars.slice(0, maxCodePoints).join('')
}

// ── Token + scope freshness ─────────────────────────────────────────────────

interface TokenCtx {
  token:         string
  broadcasterId: string
  scopes:        string[]
}

async function getStreamerCtx(): Promise<TokenCtx | null> {
  const primary = await findPrimaryStreamer('twitch')
  if (!primary) return null
  const REFRESH_MARGIN_MS = 5 * 60 * 1000
  if (primary.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS) {
    try { await refreshAndPersist({ provider: twitchProvider, rowId: primary.id }) }
    catch { return null }
  }
  const decrypted = await getDecryptedTokens(primary.id)
  if (!decrypted) return null
  return {
    token:         decrypted.accessToken,
    broadcasterId: primary.externalId,
    scopes:        primary.scopes ?? [],
  }
}

export async function hasManageBroadcastScope(): Promise<boolean> {
  const ctx = await getStreamerCtx()
  return !!ctx && ctx.scopes.includes(MANAGE_SCOPE)
}

// ── Helpers Helix ───────────────────────────────────────────────────────────

function clientId(): string | null {
  return process.env.STREAMER_TWITCH_CLIENT_ID ?? null
}

type HelixResult<T> =
  | { ok: true;  data: T }
  | { ok: false; status: number; reason: string }

async function helixFetch<T>(
  path: string,
  init: { method: 'GET' | 'PATCH' | 'POST'; token: string; body?: unknown },
): Promise<HelixResult<T>> {
  const cid = clientId()
  if (!cid) return { ok: false, status: 500, reason: 'no_client_id' }
  try {
    const res = await fetch(`${TWITCH_HELIX}${path}`, {
      method:  init.method,
      headers: {
        'Authorization': `Bearer ${init.token}`,
        'Client-Id':     cid,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    if (res.status === 204) return { ok: true, data: undefined as unknown as T }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, reason: text.slice(0, 240) || `http_${res.status}` }
    }
    if (init.method === 'PATCH') return { ok: true, data: undefined as unknown as T }
    const data = await res.json() as T
    return { ok: true, data }
  } catch (err) {
    return { ok: false, status: 0, reason: (err as Error).message.slice(0, 200) }
  }
}

// ── 1. Channel info (titre + catégorie) ─────────────────────────────────────
// PATCH /channels accepte n'importe quel sous-ensemble parmi title, game_id,
// broadcaster_language, tags, content_classification_labels, delay. Ici on
// expose juste title + game_id, le reste reste géré sur Twitch.tv.
//
// Note : passer game_id = '' (chaine vide) supprime la catégorie. Twitch
// accepte '0' comme alias pour "no category" mais '' marche aussi.

export async function updateChannelInfo(args: {
  title?:  string | undefined
  gameId?: string | undefined
}): Promise<HelixResult<void>> {
  const ctx = await getStreamerCtx()
  if (!ctx) return { ok: false, status: 401, reason: 'no_streamer' }
  if (!ctx.scopes.includes(MANAGE_SCOPE)) return { ok: false, status: 403, reason: 'missing_scope_manage_broadcast' }

  const body: Record<string, unknown> = {}
  if (typeof args.title  === 'string') body.title   = safeTruncate(args.title, 140)  // Twitch ~140 chars
  if (typeof args.gameId === 'string') body.game_id = args.gameId
  if (Object.keys(body).length === 0) return { ok: false, status: 400, reason: 'empty_patch' }

  const r = await helixFetch<void>(
    `/channels?broadcaster_id=${ctx.broadcasterId}`,
    { method: 'PATCH', token: ctx.token, body },
  )

  // Si la mise à jour passe, le cache du Hero (titre / game / etc.) doit
  // être invalidé pour que le streamer voit le changement sans attendre 60 s.
  if (r.ok) await invalidateTwitchProfileCache()
  return r
}

// ── 2. Recherche catégorie (autocomplete) ───────────────────────────────────
// PATCH /channels prend un game_id, pas un nom. On expose un search par nom
// pour que l'admin puisse autocomplete (helix renvoie déjà des correspondances
// partielles). On limite à 10 résultats côté front.

export interface GameSearchResult {
  id:       string
  name:     string
  boxArtUrl: string  // Twitch retourne avec {width}/{height} placeholders
}

interface HelixSearchCategoriesResponse {
  data?: Array<{ id: string; name: string; box_art_url: string }>
}

export async function searchGames(query: string): Promise<HelixResult<GameSearchResult[]>> {
  const q = query.trim().slice(0, 100)
  if (q.length < 2) return { ok: true, data: [] }

  const ctx = await getStreamerCtx()
  if (!ctx) return { ok: false, status: 401, reason: 'no_streamer' }

  // /search/categories ne requiert PAS de scope spécifique, juste un user
  // ou app token valide. On utilise le user token déjà chargé.
  const r = await helixFetch<HelixSearchCategoriesResponse>(
    `/search/categories?query=${encodeURIComponent(q)}&first=10`,
    { method: 'GET', token: ctx.token },
  )
  if (!r.ok) return r

  const data = (r.data.data ?? []).map(g => ({
    id:        g.id,
    name:      g.name,
    boxArtUrl: g.box_art_url.replace('{width}', '52').replace('{height}', '72'),
  }))
  return { ok: true, data }
}

// ── 3. Marker VOD ───────────────────────────────────────────────────────────
// POST /streams/markers : place un marker à la position courante du stream
// (timecode = NOW - delay éventuel). Échoue avec 404 si le streamer n'est
// pas live (Twitch refuse de placer un marker offline).

export interface CreatedMarker {
  id:                string
  createdAt:         string
  positionSeconds:   number
  description:       string | null
}

interface HelixCreateMarkerResponse {
  data?: Array<{
    id:                string
    created_at:        string
    position_seconds:  number
    description?:      string
  }>
}

export async function createMarker(args: {
  description?: string | undefined
}): Promise<HelixResult<CreatedMarker>> {
  const ctx = await getStreamerCtx()
  if (!ctx) return { ok: false, status: 401, reason: 'no_streamer' }
  if (!ctx.scopes.includes(MANAGE_SCOPE)) return { ok: false, status: 403, reason: 'missing_scope_manage_broadcast' }

  const body: Record<string, unknown> = { user_id: ctx.broadcasterId }
  if (args.description) body.description = safeTruncate(args.description, 140)

  const r = await helixFetch<HelixCreateMarkerResponse>(
    '/streams/markers',
    { method: 'POST', token: ctx.token, body },
  )
  if (!r.ok) return r

  const m = r.data.data?.[0]
  if (!m) return { ok: false, status: 502, reason: 'empty_response' }
  return {
    ok: true,
    data: {
      id:               m.id,
      createdAt:        m.created_at,
      positionSeconds:  m.position_seconds,
      description:      m.description ?? null,
    },
  }
}
