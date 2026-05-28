// ─── Streamer Hub — Chat timers (auto-messages périodiques) ────────────────
// Tick toutes les 60s. Pour chaque timer enabled :
//   - check live_only / interval / min_chat_messages
//   - render template avec {nodyx_url}, {streamer}, {uptime}
//   - dispatch via relayMessageToTwitch
//
// Le compteur de messages chat est tenu en Redis (incrémenté par
// streamerHubService côté inbound). Reset à 0 après send réussi.

import { db, redis } from '../../config/database'
import { findPrimaryStreamer } from './tokenService'
import { relayMessageToTwitch } from './twitchChatBridge'

export type TriggerMode = 'recurring' | 'once_per_live' | 'once'
export const TRIGGER_MODES: readonly TriggerMode[] = ['recurring', 'once_per_live', 'once']
export function isTriggerMode(s: unknown): s is TriggerMode {
  return typeof s === 'string' && (TRIGGER_MODES as readonly string[]).includes(s)
}

export interface ChatTimer {
  id:                string
  label:             string
  enabled:           boolean
  messageTemplate:   string
  intervalMinutes:   number
  minChatMessages:   number
  liveOnly:          boolean
  triggerMode:       TriggerMode
  lastSentAt:        Date | null
  createdAt:         Date
  updatedAt:         Date
}

interface ChatTimerRow {
  id:                 string
  label:              string
  enabled:            boolean
  message_template:   string
  interval_minutes:   number
  min_chat_messages:  number
  live_only:          boolean
  trigger_mode:       TriggerMode
  last_sent_at:       Date | null
  created_at:         Date
  updated_at:         Date
}

function rowToTimer(r: ChatTimerRow): ChatTimer {
  return {
    id:               r.id,
    label:            r.label,
    enabled:          r.enabled,
    messageTemplate:  r.message_template,
    intervalMinutes:  r.interval_minutes,
    minChatMessages:  r.min_chat_messages,
    liveOnly:         r.live_only,
    triggerMode:      r.trigger_mode,
    lastSentAt:       r.last_sent_at,
    createdAt:        r.created_at,
    updatedAt:        r.updated_at,
  }
}

const MSG_COUNT_KEY = (id: string): string => `streamer:chat:msgs_count:${id}`

// ── CRUD ───────────────────────────────────────────────────────────────────

const SELECT_COLS = `id, label, enabled, message_template, interval_minutes,
       min_chat_messages, live_only, trigger_mode, last_sent_at, created_at, updated_at`

export async function listTimers(): Promise<ChatTimer[]> {
  const r = await db.query<ChatTimerRow>(
    `SELECT ${SELECT_COLS} FROM streamer_chat_timers ORDER BY created_at ASC`,
  )
  return r.rows.map(rowToTimer)
}

export async function getTimer(id: string): Promise<ChatTimer | null> {
  const r = await db.query<ChatTimerRow>(
    `SELECT ${SELECT_COLS} FROM streamer_chat_timers WHERE id = $1`,
    [id],
  )
  return r.rows[0] ? rowToTimer(r.rows[0]) : null
}

export interface CreateTimerInput {
  label:            string
  enabled?:         boolean
  messageTemplate:  string
  intervalMinutes:  number
  minChatMessages:  number
  liveOnly:         boolean
  triggerMode:      TriggerMode
  createdBy?:       string | null
}

export async function createTimer(input: CreateTimerInput): Promise<ChatTimer> {
  const r = await db.query<ChatTimerRow>(
    `INSERT INTO streamer_chat_timers
       (label, enabled, message_template, interval_minutes, min_chat_messages, live_only, trigger_mode, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${SELECT_COLS}`,
    [
      input.label,
      input.enabled ?? true,
      input.messageTemplate,
      input.intervalMinutes,
      input.minChatMessages,
      input.liveOnly,
      input.triggerMode,
      input.createdBy ?? null,
    ],
  )
  return rowToTimer(r.rows[0])
}

export interface UpdateTimerInput {
  label?:            string
  enabled?:          boolean
  messageTemplate?:  string
  intervalMinutes?:  number
  minChatMessages?:  number
  liveOnly?:         boolean
  triggerMode?:      TriggerMode
}

export async function updateTimer(id: string, input: UpdateTimerInput): Promise<ChatTimer | null> {
  // Patch dynamique propre via fragments param-safe
  const sets: string[] = []
  const vals: unknown[] = []
  let idx = 1
  const push = (col: string, v: unknown): void => {
    sets.push(`${col} = $${idx++}`)
    vals.push(v)
  }
  if (input.label            !== undefined) push('label',             input.label)
  if (input.enabled          !== undefined) push('enabled',           input.enabled)
  if (input.messageTemplate  !== undefined) push('message_template',  input.messageTemplate)
  if (input.intervalMinutes  !== undefined) push('interval_minutes',  input.intervalMinutes)
  if (input.minChatMessages  !== undefined) push('min_chat_messages', input.minChatMessages)
  if (input.liveOnly         !== undefined) push('live_only',         input.liveOnly)
  if (input.triggerMode      !== undefined) push('trigger_mode',      input.triggerMode)

  if (sets.length === 0) return getTimer(id)

  sets.push(`updated_at = NOW()`)
  vals.push(id)

  const r = await db.query<ChatTimerRow>(
    `UPDATE streamer_chat_timers SET ${sets.join(', ')} WHERE id = $${idx}
     RETURNING ${SELECT_COLS}`,
    vals,
  )
  return r.rows[0] ? rowToTimer(r.rows[0]) : null
}

export async function deleteTimer(id: string): Promise<boolean> {
  const r = await db.query(
    `DELETE FROM streamer_chat_timers WHERE id = $1`,
    [id],
  )
  await redis.del(MSG_COUNT_KEY(id)).catch(() => {})
  return (r.rowCount ?? 0) > 0
}

// ── Compteur de messages chat ──────────────────────────────────────────────
// Appelé par streamerHubService.ingestEvent à chaque channel.chat.message
// inbound, sur tous les timers enabled. Limité par TTL 24h pour éviter
// l'accumulation infinie en cas de timer désactivé.

export async function bumpChatMessageCounter(): Promise<void> {
  const timers = await listTimers().catch(() => [])
  const enabled = timers.filter(t => t.enabled)
  if (enabled.length === 0) return
  await Promise.all(enabled.map(t =>
    redis.multi().incr(MSG_COUNT_KEY(t.id)).expire(MSG_COUNT_KEY(t.id), 86400).exec().catch(() => null),
  ))
}

// ── Stream-live check ──────────────────────────────────────────────────────

async function isStreamerLive(): Promise<boolean> {
  const r = await db.query<{ id: string }>(
    `SELECT id FROM streamer_sessions
     WHERE provider = 'twitch' AND ended_at IS NULL
     LIMIT 1`,
  ).catch(() => null)
  return (r?.rows.length ?? 0) > 0
}

// started_at de la session active, ou null si pas de live. Sert au tick pour
// le mode 'once_per_live' : un envoi fait avant ce timestamp = ancien stream.
async function getCurrentSessionStartedAt(): Promise<Date | null> {
  const r = await db.query<{ started_at: Date }>(
    `SELECT started_at FROM streamer_sessions
     WHERE provider = 'twitch' AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
  ).catch(() => null)
  return r?.rows[0]?.started_at ?? null
}

// ── Template rendering ─────────────────────────────────────────────────────

interface RenderContext {
  nodyxUrl:    string
  streamer:    string
  uptimeText:  string
}

// Aliases tolérants : les users tapent souvent une variante naturelle (url,
// lien, link, chaine, etc) au lieu du nom canonique. On accepte tout ce qui
// est raisonnable plutôt que de laisser le {placeholder} apparaitre brut dans
// le chat. Format : pour chaque valeur, la liste des noms qui résolvent vers
// elle. Case-insensitive, espaces internes tolérés.
function renderTemplate(template: string, ctx: RenderContext): string {
  const ALIASES: Array<[string[], string]> = [
    [['nodyx_url', 'url', 'lien', 'link'],      ctx.nodyxUrl],
    [['streamer', 'chaine', 'channel', 'name'], ctx.streamer],
    [['uptime', 'duree', 'duration'],           ctx.uptimeText],
  ]
  let out = template
  for (const [names, value] of ALIASES) {
    const pattern = new RegExp(`\\{\\s*(?:${names.join('|')})\\s*\\}`, 'gi')
    out = out.replace(pattern, value)
  }
  return out
}

async function buildRenderContext(): Promise<RenderContext> {
  const nodyxUrl = (process.env.FRONTEND_URL ?? '').replace(/\/$/, '')

  const primary = await findPrimaryStreamer('twitch').catch(() => null)
  const streamer = primary?.externalLogin ?? primary?.externalId ?? 'le streamer'

  // uptime
  let uptimeText = 'hors-ligne'
  const r = await db.query<{ started_at: Date }>(
    `SELECT started_at FROM streamer_sessions
     WHERE provider = 'twitch' AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
  ).catch(() => null)
  if (r?.rows[0]) {
    const ms = Date.now() - new Date(r.rows[0].started_at).getTime()
    const totalMin = Math.max(0, Math.floor(ms / 60_000))
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    uptimeText = h > 0 ? `${h}h ${m}min` : `${m}min`
  }

  return { nodyxUrl, streamer, uptimeText }
}

export async function previewTimer(template: string): Promise<string> {
  const ctx = await buildRenderContext()
  return renderTemplate(template, ctx)
}

// ── Send immédiat (admin "Envoyer maintenant" + tick) ──────────────────────

export interface SendResult {
  ok:     boolean
  reason?: string  // 'rendered_empty', 'stream_offline_required', 'relay_failed', etc.
  rendered?: string
}

async function sendTimerNow(timer: ChatTimer, opts: { bypassChecks?: boolean } = {}): Promise<SendResult> {
  if (!opts.bypassChecks && timer.liveOnly) {
    const live = await isStreamerLive()
    if (!live) return { ok: false, reason: 'stream_offline_required' }
  }

  const ctx = await buildRenderContext()
  const rendered = renderTemplate(timer.messageTemplate, ctx).trim()
  if (!rendered) return { ok: false, reason: 'rendered_empty' }

  const r = await relayMessageToTwitch({
    provider:       'twitch',
    authorUsername: 'Nodyx',
    authorUserId:   null,
    text:           rendered,
  })
  if (!r.ok) return { ok: false, reason: r.reason ?? 'relay_failed', rendered }

  // Update last_sent_at + reset compteur. Pour le mode 'once', on auto-disable
  // le timer après envoi réussi pour qu'il ne re-déclenche jamais.
  const autoDisable = timer.triggerMode === 'once'
  await db.query(
    `UPDATE streamer_chat_timers
     SET last_sent_at = NOW(),
         updated_at   = NOW(),
         enabled      = CASE WHEN $2::boolean THEN FALSE ELSE enabled END
     WHERE id = $1`,
    [timer.id, autoDisable],
  ).catch(() => {})
  await redis.set(MSG_COUNT_KEY(timer.id), '0').catch(() => {})

  return { ok: true, rendered }
}

export async function adminSendNow(id: string): Promise<SendResult> {
  const timer = await getTimer(id)
  if (!timer) return { ok: false, reason: 'not_found' }
  // bypassChecks=true : l'admin teste, on accepte même offline
  return sendTimerNow(timer, { bypassChecks: true })
}

// ── Tick scheduler ─────────────────────────────────────────────────────────
// Appelé par setInterval(60_000) depuis index.ts. Idempotent : si plusieurs
// instances tournent, le UPDATE last_sent_at sert de garde-fou (mais on n'est
// pas dans ce cas pour Nodyx single-instance).

let tickInFlight = false

export async function tickTimers(): Promise<void> {
  if (tickInFlight) return  // pas de overlap si un tick prend > 60s
  tickInFlight = true
  try {
    const timers = await listTimers().catch(() => [])
    const candidates = timers.filter(t => t.enabled)
    if (candidates.length === 0) return

    const sessionStartedAt = await getCurrentSessionStartedAt()
    const live = sessionStartedAt !== null

    for (const timer of candidates) {
      if (timer.liveOnly && !live) continue

      // ── Filtrage par mode de déclenchement ───────────────────────────────
      if (timer.triggerMode === 'once') {
        // 'once' : si déjà envoyé une fois, plus jamais. Note : on auto-disable
        // après send réussi, donc en pratique on n'arrive ici que pour le tout
        // premier envoi. Double check defensive si quelqu'un a manuellement
        // re-enabled sans clear last_sent_at.
        if (timer.lastSentAt) continue
      } else if (timer.triggerMode === 'once_per_live') {
        // 'once_per_live' : skip si déjà envoyé DANS cette session de stream.
        // last_sent_at >= sessionStartedAt → déjà fait ce live.
        if (!sessionStartedAt) continue  // need live session
        if (timer.lastSentAt && new Date(timer.lastSentAt).getTime() >= sessionStartedAt.getTime()) continue
      } else {
        // 'recurring' : check délai d'intervalle classique
        const lastMs = timer.lastSentAt ? new Date(timer.lastSentAt).getTime() : 0
        const elapsedMin = (Date.now() - lastMs) / 60_000
        if (elapsedMin < timer.intervalMinutes) continue
      }

      // Pour 'once_per_live' on impose quand même un délai minimum après le
      // go-live pour laisser le temps aux viewers d'arriver. On réutilise
      // intervalMinutes comme "délai d'accueil" dans ce mode.
      if (timer.triggerMode === 'once_per_live' && sessionStartedAt) {
        const liveAgeMin = (Date.now() - sessionStartedAt.getTime()) / 60_000
        if (liveAgeMin < timer.intervalMinutes) {
          console.log(`[chat-timer] ${timer.label}: skip (live age ${Math.round(liveAgeMin)}min < welcome delay ${timer.intervalMinutes}min)`)
          continue
        }
      }

      // Anti-spam chat vide (sauf 'once_per_live' : on veut absolument accueillir,
      // même si le chat est calme au démarrage)
      if (timer.triggerMode !== 'once_per_live' && timer.minChatMessages > 0) {
        const raw = await redis.get(MSG_COUNT_KEY(timer.id)).catch(() => '0')
        const count = parseInt(raw ?? '0', 10) || 0
        if (count < timer.minChatMessages) {
          console.log(`[chat-timer] ${timer.label}: skip (chat=${count} < min=${timer.minChatMessages})`)
          continue
        }
      }

      console.log(`[chat-timer] dispatching "${timer.label}" (mode=${timer.triggerMode})`)
      const r = await sendTimerNow(timer, { bypassChecks: true })  // checks already done above
      if (!r.ok) console.warn(`[chat-timer] "${timer.label}" send failed: ${r.reason}`)
    }
  } finally {
    tickInFlight = false
  }
}

// ── Scheduler lifecycle ────────────────────────────────────────────────────

let schedulerHandle: NodeJS.Timeout | null = null

export function startChatTimersScheduler(): void {
  if (schedulerHandle) return
  // First tick après 30s (le temps que le serveur soit pleinement up), puis
  // toutes les 60s.
  setTimeout(() => {
    tickTimers().catch(err => console.error('[chat-timer] tick failed', err))
    schedulerHandle = setInterval(() => {
      tickTimers().catch(err => console.error('[chat-timer] tick failed', err))
    }, 60_000)
  }, 30_000)
  console.log('[chat-timer] scheduler armed (first tick in 30s, then every 60s)')
}
