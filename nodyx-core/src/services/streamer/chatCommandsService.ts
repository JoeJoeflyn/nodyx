// ─── Streamer Hub — Chat commands custom (Phase C) ─────────────────────────
// Commands éditables admin avec template de réponse. Le dispatcher principal
// (handleChatCommand) appelle findCustomCommand() après avoir constaté que la
// command ne matche aucune command hardcoded.

import { db } from '../../config/database'

export interface CustomChatCommand {
  id:                string
  name:              string         // toujours en lowercase, préfixé par !
  enabled:           boolean
  responseTemplate:  string
  modOnly:           boolean
  cooldownSeconds:   number
  createdAt:         Date
  updatedAt:         Date
}

interface CustomChatCommandRow {
  id:                 string
  name:               string
  enabled:            boolean
  response_template:  string
  mod_only:           boolean
  cooldown_seconds:   number
  created_at:         Date
  updated_at:         Date
}

function rowToCommand(r: CustomChatCommandRow): CustomChatCommand {
  return {
    id:                r.id,
    name:              r.name,
    enabled:           r.enabled,
    responseTemplate:  r.response_template,
    modOnly:           r.mod_only,
    cooldownSeconds:   r.cooldown_seconds,
    createdAt:         r.created_at,
    updatedAt:         r.updated_at,
  }
}

const SELECT_COLS = `id, name, enabled, response_template, mod_only, cooldown_seconds, created_at, updated_at`

// ── Validation du nom ──────────────────────────────────────────────────────
// Doit commencer par !, suivi de 1-30 chars ASCII alphanum/_/-. Le pattern est
// dupliqué côté DB (CHECK) pour garder l'invariant si quelqu'un INSERT à la
// main.

const NAME_PATTERN = /^![a-z0-9_-]{1,30}$/

export function normalizeName(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  return NAME_PATTERN.test(s) ? s : null
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function listCommands(): Promise<CustomChatCommand[]> {
  const r = await db.query<CustomChatCommandRow>(
    `SELECT ${SELECT_COLS} FROM streamer_chat_commands ORDER BY name ASC`,
  )
  return r.rows.map(rowToCommand)
}

export async function getCommand(id: string): Promise<CustomChatCommand | null> {
  const r = await db.query<CustomChatCommandRow>(
    `SELECT ${SELECT_COLS} FROM streamer_chat_commands WHERE id = $1`,
    [id],
  )
  return r.rows[0] ? rowToCommand(r.rows[0]) : null
}

export async function findCustomCommand(name: string): Promise<CustomChatCommand | null> {
  const normalized = name.trim().toLowerCase()
  if (!normalized.startsWith('!')) return null
  const r = await db.query<CustomChatCommandRow>(
    `SELECT ${SELECT_COLS} FROM streamer_chat_commands
     WHERE name = $1 AND enabled = TRUE LIMIT 1`,
    [normalized],
  )
  return r.rows[0] ? rowToCommand(r.rows[0]) : null
}

export interface CreateCommandInput {
  name:              string
  enabled?:          boolean
  responseTemplate:  string
  modOnly:           boolean
  cooldownSeconds:   number
  createdBy?:        string | null
}

export async function createCommand(input: CreateCommandInput): Promise<CustomChatCommand> {
  const r = await db.query<CustomChatCommandRow>(
    `INSERT INTO streamer_chat_commands
       (name, enabled, response_template, mod_only, cooldown_seconds, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${SELECT_COLS}`,
    [
      input.name,
      input.enabled ?? true,
      input.responseTemplate,
      input.modOnly,
      input.cooldownSeconds,
      input.createdBy ?? null,
    ],
  )
  return rowToCommand(r.rows[0])
}

export interface UpdateCommandInput {
  name?:              string
  enabled?:           boolean
  responseTemplate?:  string
  modOnly?:           boolean
  cooldownSeconds?:   number
}

export async function updateCommand(id: string, input: UpdateCommandInput): Promise<CustomChatCommand | null> {
  const sets: string[] = []
  const vals: unknown[] = []
  let idx = 1
  const push = (col: string, v: unknown): void => {
    sets.push(`${col} = $${idx++}`)
    vals.push(v)
  }
  if (input.name             !== undefined) push('name',              input.name)
  if (input.enabled          !== undefined) push('enabled',           input.enabled)
  if (input.responseTemplate !== undefined) push('response_template', input.responseTemplate)
  if (input.modOnly          !== undefined) push('mod_only',          input.modOnly)
  if (input.cooldownSeconds  !== undefined) push('cooldown_seconds',  input.cooldownSeconds)

  if (sets.length === 0) return getCommand(id)

  sets.push(`updated_at = NOW()`)
  vals.push(id)

  const r = await db.query<CustomChatCommandRow>(
    `UPDATE streamer_chat_commands SET ${sets.join(', ')} WHERE id = $${idx}
     RETURNING ${SELECT_COLS}`,
    vals,
  )
  return r.rows[0] ? rowToCommand(r.rows[0]) : null
}

export async function deleteCommand(id: string): Promise<boolean> {
  const r = await db.query(`DELETE FROM streamer_chat_commands WHERE id = $1`, [id])
  return (r.rowCount ?? 0) > 0
}
