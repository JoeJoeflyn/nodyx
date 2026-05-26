// ─── Streamer Hub — Goal Bar state aggregator ──────────────────────────────
// Calcule la valeur `current` d'une overlay goal_bar selon son goalType :
//   - followers_total : helix /channels/followers → .total
//   - subs_session    : COUNT(channel.subscribe + subscription.gift) depuis
//                       le started_at de la session ouverte (NULL si offline)
//   - bits_session    : SUM bits de channel.cheer sur la même fenêtre
//   - custom          : valeur saisie manuellement dans la config (passthrough)

import { db } from '../../config/database'
import { findPrimaryStreamer, getDecryptedTokens, refreshAndPersist } from './tokenService'
import { twitchProvider } from './providers/twitchProvider'
import type { GoalBarConfig, GoalBarCustomTheme, GoalBarTheme, GoalType } from './overlayService'

const TWITCH_HELIX = 'https://api.twitch.tv/helix'

interface SessionRow { started_at: string }

async function getOpenSessionStart(): Promise<string | null> {
  const r = await db.query<SessionRow>(
    `SELECT started_at FROM streamer_sessions
     WHERE provider = 'twitch' AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
  ).catch(() => null)
  return r?.rows[0]?.started_at ?? null
}

interface HelixFollowersResponse { total?: number }

async function fetchFollowerTotal(): Promise<number> {
  const primary = await findPrimaryStreamer('twitch')
  if (!primary) return 0
  // Refresh préventif si le token est < 5min de l'expiration
  if (primary.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    try { await refreshAndPersist({ provider: twitchProvider, rowId: primary.id }) }
    catch { return 0 }
  }
  const decrypted = await getDecryptedTokens(primary.id)
  if (!decrypted) return 0
  const cid = process.env.STREAMER_TWITCH_CLIENT_ID
  if (!cid) return 0
  try {
    const res = await fetch(
      `${TWITCH_HELIX}/channels/followers?broadcaster_id=${primary.externalId}&first=1`,
      { headers: {
        'Authorization': `Bearer ${decrypted.accessToken}`,
        'Client-Id':     cid,
      } },
    )
    if (!res.ok) return 0
    const data = await res.json() as HelixFollowersResponse
    return typeof data.total === 'number' ? data.total : 0
  } catch {
    return 0
  }
}

async function countSubsSinceSession(startedAt: string | null): Promise<number> {
  if (!startedAt) return 0
  const r = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM streamer_events
     WHERE provider = 'twitch'
       AND occurred_at >= $1
       AND event_type IN ('channel.subscribe', 'channel.subscription.gift')
       AND (external_id IS NULL OR external_id NOT LIKE 'test-%')`,
    [startedAt],
  ).catch(() => null)
  return parseInt(r?.rows[0]?.count ?? '0', 10) || 0
}

async function sumBitsSinceSession(startedAt: string | null): Promise<number> {
  if (!startedAt) return 0
  // bits est dans payload.event.bits (jsonb). On COALESCE pour les events
  // dégradés sans champ bits. Cast en bigint puis sum.
  const r = await db.query<{ total: string | null }>(
    `SELECT COALESCE(SUM((payload->'event'->>'bits')::bigint), 0)::text AS total
     FROM streamer_events
     WHERE provider = 'twitch'
       AND occurred_at >= $1
       AND event_type = 'channel.cheer'
       AND (external_id IS NULL OR external_id NOT LIKE 'test-%')`,
    [startedAt],
  ).catch(() => null)
  return parseInt(r?.rows[0]?.total ?? '0', 10) || 0
}

export interface GoalBarState {
  current:     number
  target:      number
  percent:     number              // 0 à 100, capé à 100
  reached:     boolean             // current >= target
  label:       string
  goalType:    GoalType
  accent:      string
  theme:       GoalBarTheme
  customTheme: GoalBarCustomTheme | undefined
}

export async function computeGoalBarState(cfg: GoalBarConfig): Promise<GoalBarState> {
  let current = 0
  switch (cfg.goalType) {
    case 'followers_total':
      current = await fetchFollowerTotal()
      break
    case 'subs_session': {
      const start = await getOpenSessionStart()
      current = await countSubsSinceSession(start)
      break
    }
    case 'bits_session': {
      const start = await getOpenSessionStart()
      current = await sumBitsSinceSession(start)
      break
    }
    case 'custom':
      current = Math.max(0, cfg.customCurrent)
      break
  }
  const target  = Math.max(1, cfg.target)
  const percent = Math.min(100, Math.round((current / target) * 100))
  return {
    current,
    target,
    percent,
    reached:     current >= target,
    label:       cfg.label,
    goalType:    cfg.goalType,
    accent:      cfg.accentColor,
    theme:       cfg.theme,
    customTheme: cfg.customTheme,
  }
}
