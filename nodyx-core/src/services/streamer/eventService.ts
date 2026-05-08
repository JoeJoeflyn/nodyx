// ─── Streamer Hub — events log service ──────────────────────────────────────
// Persistence des événements EventSub reçus, pour audit + dispatch + récap.
// Public API:
//   recordEvent(args)          → row id
//   listRecentEvents(opts)     → rows (debug + admin UI)
//   markProcessed(eventId)     → marque qu'on a traité l'event (dispatched chat, etc.)

import { db } from '../../config/database'
import type { ProviderId } from './providers/_types'

interface EventRowDb {
  id:           string
  provider:     ProviderId
  event_type:   string
  external_id:  string | null
  payload:      Record<string, unknown>
  user_id:      string | null
  occurred_at:  Date
  processed_at: Date | null
}

export interface StreamerEventRow {
  id:           string
  provider:     ProviderId
  eventType:    string
  externalId:   string | null
  payload:      Record<string, unknown>
  userId:       string | null
  occurredAt:   Date
  processedAt:  Date | null
}

function rowToPublic(row: EventRowDb): StreamerEventRow {
  return {
    id:          row.id,
    provider:    row.provider,
    eventType:   row.event_type,
    externalId:  row.external_id,
    payload:     row.payload,
    userId:      row.user_id,
    occurredAt:  row.occurred_at,
    processedAt: row.processed_at,
  }
}

// ── Record ───────────────────────────────────────────────────────────────────

export async function recordEvent(args: {
  provider:    ProviderId
  eventType:   string
  externalId?: string | null
  payload:     Record<string, unknown>
  userId?:     string | null
}): Promise<StreamerEventRow> {
  const result = await db.query<EventRowDb>(
    `INSERT INTO streamer_events
       (provider, event_type, external_id, payload, user_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [
      args.provider,
      args.eventType,
      args.externalId ?? null,
      JSON.stringify(args.payload),
      args.userId ?? null,
    ],
  )
  return rowToPublic(result.rows[0])
}

// ── List (admin UI / debug) ──────────────────────────────────────────────────

export async function listRecentEvents(opts?: {
  provider?:  ProviderId
  eventType?: string
  limit?:     number
  before?:    Date
}): Promise<StreamerEventRow[]> {
  const limit  = Math.min(Math.max(opts?.limit ?? 50, 1), 500)
  const params: unknown[] = []
  const where: string[]   = []

  if (opts?.provider)  { params.push(opts.provider);  where.push(`provider = $${params.length}`) }
  if (opts?.eventType) { params.push(opts.eventType); where.push(`event_type = $${params.length}`) }
  if (opts?.before)    { params.push(opts.before);    where.push(`occurred_at < $${params.length}`) }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  params.push(limit)

  const result = await db.query<EventRowDb>(
    `SELECT * FROM streamer_events ${whereSql}
     ORDER BY occurred_at DESC LIMIT $${params.length}`,
    params,
  )
  return result.rows.map(rowToPublic)
}

export async function markProcessed(eventId: string): Promise<void> {
  await db.query(
    `UPDATE streamer_events SET processed_at = NOW() WHERE id = $1`,
    [eventId],
  )
}
