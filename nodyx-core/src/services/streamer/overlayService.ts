// ─── Streamer Hub — overlays service (CRUD + dispatch) ─────────────────────
// Gère le cycle de vie des overlays OBS : création (token random unguessable),
// listing admin, revoke, lookup par token (auth socket).
//
// Note : un overlay = 1 token = 1 URL à coller dans OBS. Le streamer peut en
// avoir plusieurs du même type (ex: 2 alert box, une pour follow/sub et une
// pour raid uniquement) avec des configs différentes.

import { randomBytes } from 'node:crypto'
import { db } from '../../config/database'

export type OverlayType =
  | 'alert_box'
  | 'goal_bar'
  | 'stream_timer'
  | 'event_ticker'
  | 'leaderboard'

const VALID_TYPES: ReadonlySet<OverlayType> = new Set([
  'alert_box', 'goal_bar', 'stream_timer', 'event_ticker', 'leaderboard',
])

export function isOverlayType(s: string): s is OverlayType {
  return VALID_TYPES.has(s as OverlayType)
}

// ── Config schemas par type d'overlay ───────────────────────────────────────
// Stocké dans streamer_overlays.config (JSONB) avec une shape par type. La
// page overlay frontend lit cette config au boot et l'applique (theme, durée,
// templates de message). Le streamer édite via PATCH /overlays/:id.

export type AlertBoxTheme = 'cyber' | 'soft' | 'retro' | 'neon' | 'holographic' | 'minimal' | 'custom'
export const ALERT_BOX_THEMES: readonly AlertBoxTheme[] = ['cyber', 'soft', 'retro', 'neon', 'holographic', 'minimal', 'custom']

export type AlertPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center'
export const ALERT_POSITIONS: readonly AlertPosition[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center']

export type AlertAnimation = 'slide-right' | 'slide-left' | 'slide-top' | 'slide-bottom' | 'scale' | 'bounce' | 'fade'
export const ALERT_ANIMATIONS: readonly AlertAnimation[] = ['slide-right', 'slide-left', 'slide-top', 'slide-bottom', 'scale', 'bounce', 'fade']

export type AlertEventKey =
  | 'channel.follow'
  | 'channel.subscribe'
  | 'channel.subscription.gift'
  | 'channel.cheer'
  | 'channel.raid'

export interface AlertEventCfg {
  enabled:   boolean
  template:  string                // "{user_name} a follow !" — variables {var_name}
  iconUrl?:  string | null         // optionnel pour le thème custom : icône à gauche du message
  soundUrl?: string | null         // URL d'un mp3/wav à jouer quand l'event arrive
}

export interface AlertBoxCustomTheme {
  bgImageUrl?:    string | null   // image de fond de la card (https://...)
  bgColor?:       string | null   // fallback / overlay si bgImage absent (#0f172a etc)
  accentColor?:   string | null   // surcharge la couleur d'accent (sinon palette par event)
  textColor?:     string | null   // couleur du message principal
}

export interface AlertBoxConfig {
  theme:        AlertBoxTheme
  position:     AlertPosition
  animation:    AlertAnimation
  durationMs:   number
  soundVolume:  number                  // 0 à 1, appliqué à tous les sons
  events:       Record<AlertEventKey, AlertEventCfg>
  customTheme?: AlertBoxCustomTheme    // uniquement utilisé si theme === 'custom'
}

// Config par défaut quand on crée un alert_box ou si l'admin n'a rien
// personnalisé. Tu peux toujours éditer ensuite via le panneau admin.
export const DEFAULT_ALERT_BOX_CONFIG: AlertBoxConfig = {
  theme:       'cyber',
  position:    'top-right',
  animation:   'slide-right',
  durationMs:  5000,
  soundVolume: 0.6,
  events: {
    'channel.follow':            { enabled: true, template: '{user_name} a follow !' },
    'channel.subscribe':         { enabled: true, template: '{user_name} s\'abonne (tier {tier}) !' },
    'channel.subscription.gift': { enabled: true, template: '{user_name} offre {total} sub{total_plural} !' },
    'channel.cheer':             { enabled: true, template: '{user_name} envoie {bits} bits !' },
    'channel.raid':              { enabled: true, template: 'Raid de {from_broadcaster_user_name} avec {viewers} viewers !' },
  },
}

// Merge config DB partielle avec les defaults (l'admin peut ne configurer
// que la moitié des events ; le reste tombe sur les defaults plutôt que
// de casser la page overlay).
export function withAlertBoxDefaults(raw: Record<string, unknown> | undefined): AlertBoxConfig {
  const cfg = raw ?? {}
  const events = { ...DEFAULT_ALERT_BOX_CONFIG.events }
  const rawEvents = (cfg.events ?? {}) as Record<string, Partial<AlertEventCfg>>
  for (const k of Object.keys(events) as AlertEventKey[]) {
    const incoming = rawEvents[k]
    if (incoming && typeof incoming === 'object') {
      events[k] = {
        enabled:  typeof incoming.enabled  === 'boolean' ? incoming.enabled  : events[k].enabled,
        template: typeof incoming.template === 'string'  ? incoming.template : events[k].template,
        iconUrl:  typeof incoming.iconUrl  === 'string'  ? incoming.iconUrl  : null,
        soundUrl: typeof incoming.soundUrl === 'string'  ? incoming.soundUrl : null,
      }
    }
  }
  const theme = ALERT_BOX_THEMES.includes(cfg.theme as AlertBoxTheme)
    ? cfg.theme as AlertBoxTheme
    : DEFAULT_ALERT_BOX_CONFIG.theme
  const position = ALERT_POSITIONS.includes(cfg.position as AlertPosition)
    ? cfg.position as AlertPosition
    : DEFAULT_ALERT_BOX_CONFIG.position
  const animation = ALERT_ANIMATIONS.includes(cfg.animation as AlertAnimation)
    ? cfg.animation as AlertAnimation
    : DEFAULT_ALERT_BOX_CONFIG.animation
  const durationMs = typeof cfg.durationMs === 'number' && cfg.durationMs >= 1000 && cfg.durationMs <= 30000
    ? cfg.durationMs
    : DEFAULT_ALERT_BOX_CONFIG.durationMs
  const soundVolume = typeof cfg.soundVolume === 'number' && cfg.soundVolume >= 0 && cfg.soundVolume <= 1
    ? cfg.soundVolume
    : DEFAULT_ALERT_BOX_CONFIG.soundVolume
  const ct = (cfg.customTheme ?? {}) as Partial<AlertBoxCustomTheme>
  const customTheme: AlertBoxCustomTheme = {
    bgImageUrl:  typeof ct.bgImageUrl  === 'string' ? ct.bgImageUrl  : null,
    bgColor:     typeof ct.bgColor     === 'string' ? ct.bgColor     : null,
    accentColor: typeof ct.accentColor === 'string' ? ct.accentColor : null,
    textColor:   typeof ct.textColor   === 'string' ? ct.textColor   : null,
  }
  return { theme, position, animation, durationMs, soundVolume, events, customTheme }
}

export interface OverlayRow {
  id:           string
  token:        string
  overlayType:  OverlayType
  label:        string | null
  config:       Record<string, unknown>
  createdBy:    string | null
  createdAt:    string
  updatedAt:    string
  revokedAt:    string | null
  lastSeenAt:   string | null
}

interface OverlayRowDb {
  id:            string
  token:         string
  overlay_type:  string
  label:         string | null
  config:        Record<string, unknown>
  created_by:    string | null
  created_at:    string
  updated_at:    string
  revoked_at:    string | null
  last_seen_at:  string | null
}

function rowToPublic(r: OverlayRowDb): OverlayRow {
  return {
    id:          r.id,
    token:       r.token,
    overlayType: r.overlay_type as OverlayType,
    label:       r.label,
    config:      r.config ?? {},
    createdBy:   r.created_by,
    createdAt:   r.created_at,
    updatedAt:   r.updated_at,
    revokedAt:   r.revoked_at,
    lastSeenAt:  r.last_seen_at,
  }
}

// ── Token gen (43 chars base64url, ~256 bits d'entropie) ────────────────────
function generateToken(): string {
  // randomBytes(32) → base64url sans padding = 43 chars, URL-safe pour les
  // overlays embarquées dans OBS browser source.
  return randomBytes(32).toString('base64url')
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function createOverlay(args: {
  overlayType: OverlayType
  label?:      string | null
  config?:     Record<string, unknown>
  createdBy?:  string | null
}): Promise<OverlayRow> {
  const r = await db.query<OverlayRowDb>(
    `INSERT INTO streamer_overlays (token, overlay_type, label, config, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      generateToken(),
      args.overlayType,
      args.label ?? null,
      JSON.stringify(args.config ?? {}),
      args.createdBy ?? null,
    ],
  )
  return rowToPublic(r.rows[0])
}

export async function listOverlays(opts?: { includeRevoked?: boolean }): Promise<OverlayRow[]> {
  const r = opts?.includeRevoked
    ? await db.query<OverlayRowDb>(`SELECT * FROM streamer_overlays ORDER BY created_at DESC LIMIT 100`)
    : await db.query<OverlayRowDb>(`SELECT * FROM streamer_overlays WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 100`)
  return r.rows.map(rowToPublic)
}

export async function findOverlayByToken(token: string): Promise<OverlayRow | null> {
  if (!token || token.length < 16) return null     // garde-fou anti probe
  const r = await db.query<OverlayRowDb>(
    `SELECT * FROM streamer_overlays WHERE token = $1 AND revoked_at IS NULL LIMIT 1`,
    [token],
  )
  return r.rows[0] ? rowToPublic(r.rows[0]) : null
}

export async function findOverlayById(id: string): Promise<OverlayRow | null> {
  const r = await db.query<OverlayRowDb>(`SELECT * FROM streamer_overlays WHERE id = $1 LIMIT 1`, [id])
  return r.rows[0] ? rowToPublic(r.rows[0]) : null
}

export async function updateOverlayConfig(args: {
  id:     string
  label?: string | null
  config?: Record<string, unknown>
}): Promise<OverlayRow | null> {
  const sets:   string[] = ['updated_at = NOW()']
  const values: unknown[] = []
  let i = 1
  if (args.label !== undefined)  { sets.push(`label = $${i++}`);  values.push(args.label) }
  if (args.config !== undefined) { sets.push(`config = $${i++}::jsonb`); values.push(JSON.stringify(args.config)) }
  if (values.length === 0) return findOverlayById(args.id)

  values.push(args.id)
  const r = await db.query<OverlayRowDb>(
    `UPDATE streamer_overlays SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  )
  return r.rows[0] ? rowToPublic(r.rows[0]) : null
}

export async function revokeOverlay(id: string): Promise<boolean> {
  const r = await db.query<{ id: string }>(
    `UPDATE streamer_overlays SET revoked_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
    [id],
  )
  return r.rows.length > 0
}

export async function touchOverlayLastSeen(id: string): Promise<void> {
  await db.query(`UPDATE streamer_overlays SET last_seen_at = NOW() WHERE id = $1`, [id]).catch(() => {})
}
