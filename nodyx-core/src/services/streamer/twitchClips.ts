// ─── Streamer Hub — Twitch Clips ───────────────────────────────────────────
// Wrappers helix /clips :
//   - listOwnTopClips(period, limit)              → top clips de la chaine connectée
//   - listClipsForBroadcaster(broadcasterId, ...) → top clips d'un autre streamer
//     (utilisé pour récupérer les clips d'un raider à showcase)
//   - listRecentRaids(limit)                      → derniers raids reçus, depuis streamer_events
//
// Cache Redis 5 min sur les listes (clips Twitch sont assez stables, mais on
// veut suivre les vues qui montent + nouveaux clips créés pendant le live).

import { redis } from '../../config/database'
import { db } from '../../config/database'
import { findPrimaryStreamer, getDecryptedTokens, refreshAndPersist } from './tokenService'
import { twitchProvider } from './providers/twitchProvider'

const TWITCH_HELIX  = 'https://api.twitch.tv/helix'
const CACHE_TTL_SEC = 300        // 5 min

interface TokenCtx {
  token:         string
  broadcasterId: string
}

async function getStreamerCtx(): Promise<TokenCtx | null> {
  const primary = await findPrimaryStreamer('twitch')
  if (!primary) return null
  if (primary.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    try { await refreshAndPersist({ provider: twitchProvider, rowId: primary.id }) }
    catch { return null }
  }
  const decrypted = await getDecryptedTokens(primary.id)
  if (!decrypted) return null
  return { token: decrypted.accessToken, broadcasterId: primary.externalId }
}

export interface TwitchClip {
  id:                string
  url:               string
  embedUrl:          string
  broadcasterId:     string
  broadcasterName:   string
  creatorId:         string
  creatorName:       string
  videoId:           string
  gameId:            string
  language:          string
  title:             string
  viewCount:         number
  createdAt:         string
  thumbnailUrl:      string
  duration:          number             // seconds
  vodOffset:         number | null      // null si le VOD a expiré
}

interface HelixClipRaw {
  id:                string
  url:               string
  embed_url:         string
  broadcaster_id:    string
  broadcaster_name:  string
  creator_id:        string
  creator_name:      string
  video_id:          string
  game_id:           string
  language:          string
  title:             string
  view_count:        number
  created_at:        string
  thumbnail_url:     string
  duration:          number
  vod_offset:        number | null
}

interface HelixClipsResponse { data?: HelixClipRaw[] }

function mapClip(c: HelixClipRaw): TwitchClip {
  return {
    id:               c.id,
    url:              c.url,
    embedUrl:         c.embed_url,
    broadcasterId:    c.broadcaster_id,
    broadcasterName:  c.broadcaster_name,
    creatorId:        c.creator_id,
    creatorName:      c.creator_name,
    videoId:          c.video_id,
    gameId:           c.game_id,
    language:         c.language,
    title:            c.title,
    viewCount:        c.view_count,
    createdAt:        c.created_at,
    thumbnailUrl:     c.thumbnail_url,
    duration:         c.duration,
    vodOffset:        c.vod_offset,
  }
}

// ── Helix fetch helper ──────────────────────────────────────────────────────

async function helixGet<T>(path: string, token: string): Promise<T | null> {
  const cid = process.env.STREAMER_TWITCH_CLIENT_ID
  if (!cid) return null
  try {
    const res = await fetch(`${TWITCH_HELIX}${path}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': cid },
    })
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export type ClipsPeriod = '7d' | '30d' | 'all'

function buildTimeRangeForHelix(period: ClipsPeriod): string {
  if (period === 'all') return ''
  const days = period === '7d' ? 7 : 30
  const end   = new Date()
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
  return `&started_at=${encodeURIComponent(start.toISOString())}&ended_at=${encodeURIComponent(end.toISOString())}`
}

export async function listOwnTopClips(period: ClipsPeriod, limit = 20): Promise<TwitchClip[]> {
  const ctx = await getStreamerCtx()
  if (!ctx) return []

  const cacheKey = `streamer:clips:own:${period}:${limit}`
  const cached = await redis.get(cacheKey).catch(() => null)
  if (cached) {
    try { return JSON.parse(cached) as TwitchClip[] } catch { /* fallthrough */ }
  }

  const safeLimit = Math.min(100, Math.max(1, limit))
  const timeRange = buildTimeRangeForHelix(period)
  const data = await helixGet<HelixClipsResponse>(
    `/clips?broadcaster_id=${ctx.broadcasterId}&first=${safeLimit}${timeRange}`,
    ctx.token,
  )
  // Helix retourne déjà trié par view_count desc par défaut quand on demande
  // une broadcaster_id + range.
  const clips = (data?.data ?? []).map(mapClip)

  await redis.set(cacheKey, JSON.stringify(clips), 'EX', CACHE_TTL_SEC).catch(() => {})
  return clips
}

export async function listClipsForBroadcaster(broadcasterId: string, limit = 5): Promise<TwitchClip[]> {
  const ctx = await getStreamerCtx()
  if (!ctx) return []

  const cacheKey = `streamer:clips:raider:${broadcasterId}:${limit}`
  const cached = await redis.get(cacheKey).catch(() => null)
  if (cached) {
    try { return JSON.parse(cached) as TwitchClip[] } catch { /* fallthrough */ }
  }

  const safeLimit = Math.min(100, Math.max(1, limit))
  // Pour les clips d'un raider, on prend les 30 derniers jours pour rester
  // pertinent (un raider d'il y a 2 ans avec des vieux clips, c'est moins
  // sympa à présenter à ton chat).
  const timeRange = buildTimeRangeForHelix('30d')
  const data = await helixGet<HelixClipsResponse>(
    `/clips?broadcaster_id=${broadcasterId}&first=${safeLimit}${timeRange}`,
    ctx.token,
  )
  const clips = (data?.data ?? []).map(mapClip)

  await redis.set(cacheKey, JSON.stringify(clips), 'EX', CACHE_TTL_SEC).catch(() => {})
  return clips
}

// ── Liste des raids récents depuis streamer_events ─────────────────────────

export interface RecentRaid {
  id:                       string
  occurredAt:               string
  fromBroadcasterUserId:    string
  fromBroadcasterUserLogin: string
  fromBroadcasterUserName:  string
  viewers:                  number
}

export async function listRecentRaids(limit = 10): Promise<RecentRaid[]> {
  const r = await db.query<{ id: string; occurred_at: string; payload: { event?: Record<string, unknown> } }>(
    `SELECT id, occurred_at, payload
     FROM streamer_events
     WHERE provider = 'twitch'
       AND event_type = 'channel.raid'
       AND (external_id IS NULL OR external_id NOT LIKE 'test-%')
     ORDER BY occurred_at DESC
     LIMIT $1`,
    [Math.min(50, Math.max(1, limit))],
  ).catch(() => null)
  if (!r) return []

  return r.rows.map(row => {
    const e = row.payload?.event ?? {}
    return {
      id:                       row.id,
      occurredAt:               row.occurred_at,
      fromBroadcasterUserId:    (e.from_broadcaster_user_id    as string) ?? '',
      fromBroadcasterUserLogin: (e.from_broadcaster_user_login as string) ?? '',
      fromBroadcasterUserName:  (e.from_broadcaster_user_name  as string) ?? '',
      viewers:                  Number(e.viewers ?? 0),
    }
  }).filter(r => r.fromBroadcasterUserId.length > 0)
}
