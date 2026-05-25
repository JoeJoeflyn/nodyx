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
