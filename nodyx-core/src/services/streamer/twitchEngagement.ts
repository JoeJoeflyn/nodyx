// ─── Streamer Hub — Engagement live (Polls + Prédictions) ──────────────────
// Wrappers helix pour piloter sondages et prédictions Twitch depuis Nodyx.
// Scopes requis : channel:manage:polls + channel:manage:predictions (et leur
// counterpart channel:read:* pour récupérer l'état courant).
//
// Pattern : on garde uniquement le user access token du streamer connecté,
// même politique de refresh que twitchProfile / twitchChatBridge. Helix
// rejette les opérations engagement quand le streamer n'est pas live ; on
// remonte l'erreur Twitch telle quelle pour que le frontend l'affiche.

import { findPrimaryStreamer, getDecryptedTokens, refreshAndPersist } from './tokenService'
import { twitchProvider } from './providers/twitchProvider'

const TWITCH_HELIX  = 'https://api.twitch.tv/helix'
const POLLS_SCOPE   = 'channel:manage:polls'
const PRED_SCOPE    = 'channel:manage:predictions'

// ── Token + scope helpers ───────────────────────────────────────────────────

interface TokenCtx {
  token:         string
  broadcasterId: string
  scopes:        string[]
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
  return {
    token:         decrypted.accessToken,
    broadcasterId: primary.externalId,
    scopes:        primary.scopes ?? [],
  }
}

export interface EngagementScopeStatus {
  hasPolls:       boolean
  hasPredictions: boolean
}

export async function getEngagementScopes(): Promise<EngagementScopeStatus> {
  const ctx = await getStreamerCtx()
  if (!ctx) return { hasPolls: false, hasPredictions: false }
  return {
    hasPolls:       ctx.scopes.includes(POLLS_SCOPE),
    hasPredictions: ctx.scopes.includes(PRED_SCOPE),
  }
}

// ── Helix fetch helper (mêmes garde-fous que twitchStreamControl) ───────────

type HelixResult<T> =
  | { ok: true;  data: T }
  | { ok: false; status: number; reason: string }

async function helix<T>(
  path:   string,
  init:   { method: 'GET' | 'POST' | 'PATCH'; token: string; body?: unknown },
): Promise<HelixResult<T>> {
  const cid = process.env.STREAMER_TWITCH_CLIENT_ID
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
    const data = await res.json() as T
    return { ok: true, data }
  } catch (err) {
    return { ok: false, status: 0, reason: (err as Error).message.slice(0, 200) }
  }
}

// ── Types publics ───────────────────────────────────────────────────────────

export interface ActivePoll {
  id:                          string
  title:                       string
  status:                      'ACTIVE' | 'COMPLETED' | 'TERMINATED' | 'ARCHIVED' | 'MODERATED' | 'INVALID'
  choices: Array<{
    id:                        string
    title:                     string
    votes:                     number
    channelPointsVotes:        number
  }>
  channelPointsVotingEnabled:  boolean
  channelPointsPerVote:        number
  startedAt:                   string
  endedAt:                     string | null
  durationSeconds:             number
}

export interface ActivePrediction {
  id:                   string
  title:                string
  status:               'ACTIVE' | 'LOCKED' | 'RESOLVED' | 'CANCELED'
  winningOutcomeId:     string | null
  outcomes: Array<{
    id:                 string
    title:              string
    color:              'BLUE' | 'PINK'
    users:              number
    channelPoints:      number
    topPredictors?:     Array<{ user_name: string; channel_points_used: number }>
  }>
  predictionWindowSeconds: number
  startedAt:            string
  lockedAt:             string | null
  endedAt:              string | null
}

// ── Polls ───────────────────────────────────────────────────────────────────

interface HelixPollChoice { id: string; title: string; votes: number; channel_points_votes: number }
interface HelixPoll {
  id: string; title: string; status: ActivePoll['status']
  choices: HelixPollChoice[]
  channel_points_voting_enabled: boolean
  channel_points_per_vote: number
  started_at: string; ended_at: string | null
  duration: number
}
interface HelixPollsResponse { data?: HelixPoll[] }

function mapPoll(p: HelixPoll): ActivePoll {
  return {
    id:                         p.id,
    title:                      p.title,
    status:                     p.status,
    choices: p.choices.map(c => ({
      id:                       c.id,
      title:                    c.title,
      votes:                    c.votes,
      channelPointsVotes:       c.channel_points_votes,
    })),
    channelPointsVotingEnabled: p.channel_points_voting_enabled,
    channelPointsPerVote:       p.channel_points_per_vote,
    startedAt:                  p.started_at,
    endedAt:                    p.ended_at,
    durationSeconds:            p.duration,
  }
}

export async function getActivePoll(): Promise<HelixResult<ActivePoll | null>> {
  const ctx = await getStreamerCtx()
  if (!ctx) return { ok: false, status: 401, reason: 'no_streamer' }
  const r = await helix<HelixPollsResponse>(`/polls?broadcaster_id=${ctx.broadcasterId}&first=1`, { method: 'GET', token: ctx.token })
  if (!r.ok) return r
  const p = r.data.data?.[0]
  // Twitch renvoie aussi les polls passés ; on ne considère "active" que ACTIVE.
  if (!p || p.status !== 'ACTIVE') return { ok: true, data: null }
  return { ok: true, data: mapPoll(p) }
}

export async function createPoll(args: {
  title:    string
  choices:  string[]            // 2 à 5
  duration: number              // secondes, 15 à 1800
}): Promise<HelixResult<ActivePoll>> {
  const ctx = await getStreamerCtx()
  if (!ctx) return { ok: false, status: 401, reason: 'no_streamer' }
  if (!ctx.scopes.includes(POLLS_SCOPE)) return { ok: false, status: 403, reason: 'missing_scope_manage_polls' }
  if (args.choices.length < 2 || args.choices.length > 5) return { ok: false, status: 400, reason: 'invalid_choices_count' }

  const body = {
    broadcaster_id: ctx.broadcasterId,
    title:          args.title.slice(0, 60),                              // Twitch ≤ 60
    choices:        args.choices.map(c => ({ title: c.slice(0, 25) })),   // ≤ 25 / choix
    duration:       Math.min(1800, Math.max(15, args.duration)),
  }
  const r = await helix<HelixPollsResponse>('/polls', { method: 'POST', token: ctx.token, body })
  if (!r.ok) return r
  const p = r.data.data?.[0]
  if (!p) return { ok: false, status: 502, reason: 'empty_response' }
  return { ok: true, data: mapPoll(p) }
}

export async function endPoll(args: {
  pollId: string
  status: 'TERMINATED' | 'ARCHIVED'    // TERMINATED affiche les résultats, ARCHIVED jette
}): Promise<HelixResult<ActivePoll>> {
  const ctx = await getStreamerCtx()
  if (!ctx) return { ok: false, status: 401, reason: 'no_streamer' }
  if (!ctx.scopes.includes(POLLS_SCOPE)) return { ok: false, status: 403, reason: 'missing_scope_manage_polls' }

  const body = { broadcaster_id: ctx.broadcasterId, id: args.pollId, status: args.status }
  const r = await helix<HelixPollsResponse>('/polls', { method: 'PATCH', token: ctx.token, body })
  if (!r.ok) return r
  const p = r.data.data?.[0]
  if (!p) return { ok: false, status: 502, reason: 'empty_response' }
  return { ok: true, data: mapPoll(p) }
}

// ── Predictions ─────────────────────────────────────────────────────────────

interface HelixPredOutcome {
  id:                       string
  title:                    string
  color:                    'BLUE' | 'PINK'
  users:                    number
  channel_points:           number
  top_predictors?:          Array<{ user_name: string; channel_points_used: number }>
}
interface HelixPrediction {
  id:                       string
  title:                    string
  status:                   ActivePrediction['status']
  winning_outcome_id:       string | null
  outcomes:                 HelixPredOutcome[]
  prediction_window:        number
  created_at:               string
  locked_at:                string | null
  ended_at:                 string | null
}
interface HelixPredictionsResponse { data?: HelixPrediction[] }

function mapPrediction(p: HelixPrediction): ActivePrediction {
  return {
    id:                       p.id,
    title:                    p.title,
    status:                   p.status,
    winningOutcomeId:         p.winning_outcome_id,
    outcomes: p.outcomes.map(o => ({
      id:                     o.id,
      title:                  o.title,
      color:                  o.color,
      users:                  o.users,
      channelPoints:          o.channel_points,
      topPredictors:          o.top_predictors,
    })),
    predictionWindowSeconds:  p.prediction_window,
    startedAt:                p.created_at,
    lockedAt:                 p.locked_at,
    endedAt:                  p.ended_at,
  }
}

export async function getActivePrediction(): Promise<HelixResult<ActivePrediction | null>> {
  const ctx = await getStreamerCtx()
  if (!ctx) return { ok: false, status: 401, reason: 'no_streamer' }
  const r = await helix<HelixPredictionsResponse>(`/predictions?broadcaster_id=${ctx.broadcasterId}&first=1`, { method: 'GET', token: ctx.token })
  if (!r.ok) return r
  const p = r.data.data?.[0]
  // ACTIVE = on prend les paris, LOCKED = paris fermés, en attente de résolution.
  // RESOLVED / CANCELED = histoire, pas "active".
  if (!p || (p.status !== 'ACTIVE' && p.status !== 'LOCKED')) return { ok: true, data: null }
  return { ok: true, data: mapPrediction(p) }
}

export async function createPrediction(args: {
  title:            string
  outcomes:         string[]            // 2 à 10
  predictionWindow: number              // secondes, 30 à 1800
}): Promise<HelixResult<ActivePrediction>> {
  const ctx = await getStreamerCtx()
  if (!ctx) return { ok: false, status: 401, reason: 'no_streamer' }
  if (!ctx.scopes.includes(PRED_SCOPE)) return { ok: false, status: 403, reason: 'missing_scope_manage_predictions' }
  if (args.outcomes.length < 2 || args.outcomes.length > 10) return { ok: false, status: 400, reason: 'invalid_outcomes_count' }

  const body = {
    broadcaster_id:    ctx.broadcasterId,
    title:             args.title.slice(0, 45),                                // Twitch ≤ 45
    outcomes:          args.outcomes.map(o => ({ title: o.slice(0, 25) })),    // ≤ 25 / outcome
    prediction_window: Math.min(1800, Math.max(30, args.predictionWindow)),
  }
  const r = await helix<HelixPredictionsResponse>('/predictions', { method: 'POST', token: ctx.token, body })
  if (!r.ok) return r
  const p = r.data.data?.[0]
  if (!p) return { ok: false, status: 502, reason: 'empty_response' }
  return { ok: true, data: mapPrediction(p) }
}

export async function patchPrediction(args: {
  predictionId:      string
  status:            'LOCKED' | 'RESOLVED' | 'CANCELED'
  winningOutcomeId?: string                                                    // requis si RESOLVED
}): Promise<HelixResult<ActivePrediction>> {
  const ctx = await getStreamerCtx()
  if (!ctx) return { ok: false, status: 401, reason: 'no_streamer' }
  if (!ctx.scopes.includes(PRED_SCOPE)) return { ok: false, status: 403, reason: 'missing_scope_manage_predictions' }
  if (args.status === 'RESOLVED' && !args.winningOutcomeId) {
    return { ok: false, status: 400, reason: 'winning_outcome_required' }
  }

  const body: Record<string, unknown> = {
    broadcaster_id: ctx.broadcasterId,
    id:             args.predictionId,
    status:         args.status,
  }
  if (args.winningOutcomeId) body.winning_outcome_id = args.winningOutcomeId

  const r = await helix<HelixPredictionsResponse>('/predictions', { method: 'PATCH', token: ctx.token, body })
  if (!r.ok) return r
  const p = r.data.data?.[0]
  if (!p) return { ok: false, status: 502, reason: 'empty_response' }
  return { ok: true, data: mapPrediction(p) }
}
