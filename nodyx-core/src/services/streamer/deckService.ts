// ─── Streamer Hub — Nodyx Deck service ─────────────────────────────────────
// CRUD sur les decks + exécution d'actions depuis la page mobile. Toutes les
// actions appellent les helpers existants (twitchStreamControl, chatBridge,
// overlay dispatch). Aucune logique métier n'est dupliquée ici.

import { randomBytes } from 'node:crypto'
import { db } from '../../config/database'

// ── Types ──────────────────────────────────────────────────────────────────

export type DeckActionType = 'top_clips' | 'vod_marker' | 'chat_message' | 'trigger_command' | 'noop'

export interface DeckButton {
  id:       string
  x:        number
  y:        number
  w:        number
  h:        number
  label:    string
  icon:     string             // emoji ou nom d'icône
  gradient: string             // preset name ou format 'hex/hex'
  action:   DeckActionPayload
}

export type DeckActionPayload =
  | { type: 'noop' }
  | { type: 'top_clips';        overlayId: string; period: '7d' | '30d' | 'all'; count: number }
  | { type: 'vod_marker';       description?: string }
  | { type: 'chat_message';     text: string }
  | { type: 'trigger_command';  commandName: string }                    // ex "!discord"

export interface DeckLayout {
  rows:    number
  cols:    number
  buttons: DeckButton[]
}

export interface Deck {
  id:          string
  token:       string
  label:       string
  layout:      DeckLayout
  createdAt:   Date
  updatedAt:   Date
  revokedAt:   Date | null
  lastSeenAt:  Date | null
}

interface DeckRow {
  id:           string
  token:        string
  label:        string
  layout:       DeckLayout
  created_at:   Date
  updated_at:   Date
  revoked_at:   Date | null
  last_seen_at: Date | null
}

function rowToDeck(r: DeckRow): Deck {
  return {
    id:          r.id,
    token:       r.token,
    label:       r.label,
    layout:      sanitizeLayout(r.layout),
    createdAt:   r.created_at,
    updatedAt:   r.updated_at,
    revokedAt:   r.revoked_at,
    lastSeenAt:  r.last_seen_at,
  }
}

// ── Sanitization du layout ─────────────────────────────────────────────────
// Le JSONB peut contenir n'importe quoi (vieille install, migration ratée).
// On force une forme valide à la sortie pour que les consumers n'aient pas
// à check chaque champ.

const VALID_GRADIENT_PRESETS = ['cyber', 'neon', 'inferno', 'forest', 'minimal', 'sunset', 'ocean', 'amber']

function isValidGradient(g: unknown): g is string {
  if (typeof g !== 'string') return false
  if (VALID_GRADIENT_PRESETS.includes(g)) return true
  // Custom : "from/to" en hex (#RRGGBB or RRGGBB)
  return /^#?[a-f0-9]{6}\/#?[a-f0-9]{6}$/i.test(g)
}

function isValidActionType(t: unknown): t is DeckActionType {
  return t === 'top_clips' || t === 'vod_marker' || t === 'chat_message' || t === 'trigger_command' || t === 'noop'
}

function sanitizeButton(raw: unknown): DeckButton | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const x = Number(r.x), y = Number(r.y)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null

  const w = Math.max(1, Math.min(4, Math.floor(Number(r.w) || 1)))
  const h = Math.max(1, Math.min(4, Math.floor(Number(r.h) || 1)))
  const label    = typeof r.label === 'string'    ? r.label.slice(0, 40)    : ''
  const icon     = typeof r.icon === 'string'     ? r.icon.slice(0, 40)     : '⬜'
  const gradient = isValidGradient(r.gradient)    ? r.gradient              : 'cyber'
  const id       = typeof r.id === 'string'       ? r.id.slice(0, 64)       : randomBytes(8).toString('hex')

  const rawAction = (r.action ?? {}) as Record<string, unknown>
  const actType = isValidActionType(rawAction.type) ? rawAction.type : 'noop'
  let action: DeckActionPayload
  switch (actType) {
    case 'top_clips':
      action = {
        type:      'top_clips',
        overlayId: typeof rawAction.overlayId === 'string' ? rawAction.overlayId : '',
        period:    rawAction.period === '30d' || rawAction.period === 'all' ? rawAction.period : '7d',
        count:     Math.max(1, Math.min(20, Math.floor(Number(rawAction.count) || 5))),
      }
      break
    case 'vod_marker':
      action = {
        type:        'vod_marker',
        description: typeof rawAction.description === 'string' ? rawAction.description.slice(0, 140) : undefined,
      }
      break
    case 'chat_message':
      action = {
        type: 'chat_message',
        text: typeof rawAction.text === 'string' ? rawAction.text.slice(0, 500) : '',
      }
      break
    case 'trigger_command':
      action = {
        type:        'trigger_command',
        commandName: typeof rawAction.commandName === 'string' ? rawAction.commandName.slice(0, 40) : '',
      }
      break
    default:
      action = { type: 'noop' }
  }

  return { id, x: Math.floor(x), y: Math.floor(y), w, h, label, icon, gradient, action }
}

export function sanitizeLayout(raw: unknown): DeckLayout {
  const r = (raw ?? {}) as Record<string, unknown>
  const rows = Math.max(1, Math.min(8, Math.floor(Number(r.rows) || 3)))
  const cols = Math.max(1, Math.min(8, Math.floor(Number(r.cols) || 4)))
  const rawButtons = Array.isArray(r.buttons) ? r.buttons : []
  const buttons = rawButtons.map(sanitizeButton).filter((b): b is DeckButton => b !== null)
  return { rows, cols, buttons }
}

// ── CRUD ───────────────────────────────────────────────────────────────────

const SELECT_COLS = `id, token, label, layout, created_at, updated_at, revoked_at, last_seen_at`

function generateToken(): string {
  // 32 random bytes → 43 chars base64url, exactement comme les overlays
  return randomBytes(32).toString('base64url')
}

export async function listDecks(): Promise<Deck[]> {
  const r = await db.query<DeckRow>(
    `SELECT ${SELECT_COLS} FROM streamer_decks WHERE revoked_at IS NULL ORDER BY created_at ASC`,
  )
  return r.rows.map(rowToDeck)
}

export async function getDeck(id: string): Promise<Deck | null> {
  const r = await db.query<DeckRow>(
    `SELECT ${SELECT_COLS} FROM streamer_decks WHERE id = $1`,
    [id],
  )
  return r.rows[0] ? rowToDeck(r.rows[0]) : null
}

export async function findDeckByToken(token: string): Promise<Deck | null> {
  const r = await db.query<DeckRow>(
    `SELECT ${SELECT_COLS} FROM streamer_decks WHERE token = $1 AND revoked_at IS NULL LIMIT 1`,
    [token],
  )
  return r.rows[0] ? rowToDeck(r.rows[0]) : null
}

export async function createDeck(args: { label: string; createdBy?: string | null }): Promise<Deck> {
  const token = generateToken()
  const r = await db.query<DeckRow>(
    `INSERT INTO streamer_decks (token, label, created_by)
     VALUES ($1, $2, $3)
     RETURNING ${SELECT_COLS}`,
    [token, args.label.slice(0, 100), args.createdBy ?? null],
  )
  return rowToDeck(r.rows[0])
}

export async function updateDeck(id: string, patch: { label?: string; layout?: unknown }): Promise<Deck | null> {
  const sets: string[] = []
  const vals: unknown[] = []
  let idx = 1
  if (patch.label !== undefined) {
    sets.push(`label = $${idx++}`)
    vals.push(patch.label.slice(0, 100))
  }
  if (patch.layout !== undefined) {
    sets.push(`layout = $${idx++}::jsonb`)
    vals.push(JSON.stringify(sanitizeLayout(patch.layout)))
  }
  if (sets.length === 0) return getDeck(id)
  sets.push(`updated_at = NOW()`)
  vals.push(id)
  const r = await db.query<DeckRow>(
    `UPDATE streamer_decks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${SELECT_COLS}`,
    vals,
  )
  return r.rows[0] ? rowToDeck(r.rows[0]) : null
}

export async function revokeDeck(id: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE streamer_decks SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  )
  return (r.rowCount ?? 0) > 0
}

export async function touchDeckSeen(id: string): Promise<void> {
  await db.query(`UPDATE streamer_decks SET last_seen_at = NOW() WHERE id = $1`, [id]).catch(() => {})
}

// ── Exécution d'actions ────────────────────────────────────────────────────
// Appelé par la route publique `/deck/:token/action`. Toutes les actions sont
// async + best-effort. Le frontend mobile attend juste un ack {ok, message?}
// pour afficher un toast de retour.

export interface ActionResult {
  ok:      boolean
  message: string                  // pour le toast côté mobile
}

export async function executeAction(action: DeckActionPayload, triggeredBy: string): Promise<ActionResult> {
  switch (action.type) {
    case 'noop':
      return { ok: false, message: 'Bouton non configuré' }

    case 'top_clips': {
      const [{ listOwnTopClips }, { getClipMp4Url }, { io }] = await Promise.all([
        import('./twitchClips'),
        import('./twitchClipExtraction'),
        import('../../socket/io'),
      ])
      const clips = await listOwnTopClips(action.period, action.count)
      if (clips.length === 0) return { ok: false, message: 'Aucun clip trouvé pour cette période' }
      if (!io) return { ok: false, message: 'Service socket indisponible' }

      const enriched = await Promise.all(clips.map(async c => ({
        id:           c.id,
        embedUrl:     c.embedUrl,
        title:        c.title,
        creatorName:  c.creatorName,
        duration:     c.duration,
        thumbnailUrl: c.thumbnailUrl,
        viewCount:    c.viewCount,
        mp4Url:       await getClipMp4Url(c.id),
      })))

      io.of('/overlay').to(`overlay:${action.overlayId}`).emit('clips:play', { clips: enriched })
      console.log(`[deck] top_clips → overlay ${action.overlayId}, ${enriched.length} clips (by ${triggeredBy})`)
      return { ok: true, message: `${enriched.length} clips envoyés à l'overlay` }
    }

    case 'vod_marker': {
      const { createMarker } = await import('./twitchStreamControl')
      const description = action.description?.trim() || `Highlight via Deck (${triggeredBy})`
      const r = await createMarker({ description })
      if (!r.ok) {
        if (r.status === 404) return { ok: false, message: 'Pas de stream en cours' }
        if (r.status === 403) return { ok: false, message: 'Scope manquant (channel:manage:broadcast)' }
        return { ok: false, message: `Échec marker (HTTP ${r.status})` }
      }
      const m = Math.floor(r.data.positionSeconds / 60)
      const s = Math.floor(r.data.positionSeconds % 60)
      return { ok: true, message: `Marker placé à ${m}:${s.toString().padStart(2, '0')}` }
    }

    case 'chat_message': {
      const text = action.text.trim()
      if (!text) return { ok: false, message: 'Message vide' }
      const { relayMessageToTwitch } = await import('./twitchChatBridge')
      const r = await relayMessageToTwitch({
        provider:       'twitch',
        authorUsername: 'Nodyx',
        authorUserId:   null,
        text,
      })
      if (!r.ok) {
        if (r.reason === 'stream_offline') return { ok: false, message: 'Stream offline, message non envoyé' }
        return { ok: false, message: `Échec envoi (${r.reason ?? 'inconnu'})` }
      }
      return { ok: true, message: 'Message envoyé' }
    }

    case 'trigger_command': {
      const name = action.commandName.trim().toLowerCase()
      if (!name.startsWith('!')) return { ok: false, message: 'Nom de commande invalide' }
      // On simule le déclenchement en postant directement le résultat de la
      // command custom (les commands hardcoded ont leur propre logique : on
      // les supporte uniquement si le streamer veut leur réponse texte).
      const { findCustomCommand } = await import('./chatCommandsService')
      const custom = await findCustomCommand(name)
      if (!custom) return { ok: false, message: `Commande "${name}" inconnue` }
      const { previewTimer } = await import('./chatTimersService')
      const rendered = (await previewTimer(custom.responseTemplate).catch(() => '')).trim()
      if (!rendered) return { ok: false, message: 'Template vide' }
      const { relayMessageToTwitch } = await import('./twitchChatBridge')
      const r = await relayMessageToTwitch({
        provider:       'twitch',
        authorUsername: 'Nodyx',
        authorUserId:   null,
        text:           rendered,
      })
      if (!r.ok) return { ok: false, message: `Échec relay (${r.reason ?? 'inconnu'})` }
      return { ok: true, message: `Commande ${name} déclenchée` }
    }
  }
}
