// ─── Streamer Hub — Event Ticker state aggregator ──────────────────────────
// Retourne les N derniers events filtrés par type + période. La page
// overlay ticker reçoit cette liste au boot puis prepend les nouveaux
// events via push socket (overlay:event sur la room overlay-type:event_ticker).

import { db } from '../../config/database'
import type { TickerConfig, TickerEventKey } from './overlayService'

export interface TickerEvent {
  id:          string                                // PK streamer_events
  eventType:   TickerEventKey
  payload:     Record<string, unknown>              // payload.event pour les vars
  occurredAt:  string                                // ISO
}

interface EventRow {
  id:           string
  event_type:   string
  payload:      Record<string, unknown>
  occurred_at:  string
}

async function getOpenSessionStart(): Promise<string | null> {
  const r = await db.query<{ started_at: string }>(
    `SELECT started_at FROM streamer_sessions
     WHERE provider = 'twitch' AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
  ).catch(() => null)
  return r?.rows[0]?.started_at ?? null
}

export async function fetchTickerEvents(cfg: TickerConfig, limit = 30): Promise<TickerEvent[]> {
  if (cfg.enabledEvents.length === 0) return []

  // Filtre temporel selon period
  let timeClause = ''
  let timeParam: string | null = null
  if (cfg.period === 'session') {
    const start = await getOpenSessionStart()
    if (!start) return []
    timeClause = `AND occurred_at >= $2`
    timeParam  = start
  } else if (cfg.period === '24h') {
    timeClause = `AND occurred_at >= NOW() - INTERVAL '24 hours'`
  }
  // 'recent' = pas de filtre temps, juste les N derniers

  const params: unknown[] = [cfg.enabledEvents]
  if (timeParam) params.push(timeParam)

  const sql = `
    SELECT id, event_type, payload, occurred_at FROM streamer_events
    WHERE provider = 'twitch'
      AND event_type = ANY($1::text[])
      AND (external_id IS NULL OR external_id NOT LIKE 'test-%')
      ${timeClause}
    ORDER BY occurred_at DESC
    LIMIT ${limit}
  `

  const r = await db.query<EventRow>(sql, params).catch(() => null)
  if (!r) return []
  return r.rows.map(row => ({
    id:          row.id,
    eventType:   row.event_type as TickerEventKey,
    payload:     row.payload,
    occurredAt:  row.occurred_at,
  }))
}
