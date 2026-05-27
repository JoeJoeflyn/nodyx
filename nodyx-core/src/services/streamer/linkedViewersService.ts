// ─── Streamer Hub — Linked Viewers (Flow A) ─────────────────────────────────
// Liste les viewers Twitch qui ont link leur compte Nodyx via Flow A.
// Pour chaque viewer on remonte :
//   - nodyx identity (username + avatar nodyx)
//   - twitch identity (login + avatar twitch fetched par login si nodyx absent)
//   - activité agrégée : messages chat + events streamer_events + last activity
//
// Source de vérité du lien : users.twitch_id IS NOT NULL.

import { db } from '../../config/database'
import { resolveAvatarsByLogin } from './twitchAvatars'

export interface LinkedViewer {
  userId:         string
  username:       string                  // username Nodyx
  avatarUrl:      string | null           // avatar Nodyx OU Twitch fallback
  twitchId:       string
  twitchLogin:    string
  messageCount:   number                  // dans #twitch-chat
  eventCount:     number                  // streamer_events où user_id linké
  lastActivityAt: string | null           // max(last message, last event)
  linkedAt:       string                  // users.updated_at (approximation)
}

interface ViewerRow {
  user_id:         string
  username:        string
  avatar:          string | null
  twitch_id:       string
  twitch_login:    string
  linked_at:       string
  message_count:   string                // bigint cast text
  last_message_at: string | null
  event_count:     string
  last_event_at:   string | null
}

export async function listLinkedViewers(limit = 200): Promise<LinkedViewer[]> {
  // CTE pour les comptes message (channel_messages joint sur #twitch-chat)
  // + comptes events (streamer_events joint sur user_id). Outer join sur
  // users WHERE twitch_id pour ne récupérer que les linked.
  const sql = `
    WITH msg_stats AS (
      SELECT
        m.author_id                    AS user_id,
        COUNT(*)                       AS message_count,
        MAX(m.created_at)              AS last_message_at
      FROM channel_messages m
      JOIN channels c ON c.id = m.channel_id
      WHERE c.slug = 'twitch-chat'
      GROUP BY m.author_id
    ),
    event_stats AS (
      SELECT
        user_id,
        COUNT(*)                       AS event_count,
        MAX(occurred_at)               AS last_event_at
      FROM streamer_events
      WHERE provider = 'twitch'
        AND user_id IS NOT NULL
        AND (external_id IS NULL OR external_id NOT LIKE 'test-%')
      GROUP BY user_id
    )
    SELECT
      u.id                            AS user_id,
      u.username                      AS username,
      u.avatar                        AS avatar,
      u.twitch_id                     AS twitch_id,
      u.twitch_login                  AS twitch_login,
      u.updated_at                    AS linked_at,
      COALESCE(ms.message_count, 0)::text  AS message_count,
      ms.last_message_at              AS last_message_at,
      COALESCE(es.event_count, 0)::text    AS event_count,
      es.last_event_at                AS last_event_at
    FROM users u
    LEFT JOIN msg_stats   ms ON ms.user_id = u.id
    LEFT JOIN event_stats es ON es.user_id = u.id
    WHERE u.twitch_id IS NOT NULL
    ORDER BY GREATEST(
      COALESCE(ms.last_message_at, '1970-01-01'::timestamp),
      COALESCE(es.last_event_at,   '1970-01-01'::timestamp)
    ) DESC NULLS LAST,
    u.updated_at DESC
    LIMIT $1
  `

  const r = await db.query<ViewerRow>(sql, [Math.min(500, Math.max(1, limit))]).catch(() => null)
  const rows = r?.rows ?? []

  // Pour les linked qui n'ont pas d'avatar Nodyx, on tente une résolution
  // Twitch par login (cache 24h). Pas critique si miss : on laisse null,
  // le frontend affiche l'initial comme fallback.
  const needAvatarLogins: string[] = []
  for (const row of rows) {
    if (!row.avatar && row.twitch_login) needAvatarLogins.push(row.twitch_login.toLowerCase())
  }
  const twitchAvatars = needAvatarLogins.length > 0
    ? await resolveAvatarsByLogin(needAvatarLogins).catch(() => new Map<string, string>())
    : new Map<string, string>()

  return rows.map(row => {
    const twitchAvatar = row.twitch_login ? twitchAvatars.get(row.twitch_login.toLowerCase()) : undefined
    const lastMessageMs = row.last_message_at ? new Date(row.last_message_at).getTime() : 0
    const lastEventMs   = row.last_event_at   ? new Date(row.last_event_at).getTime()   : 0
    const lastActivityMs = Math.max(lastMessageMs, lastEventMs)
    return {
      userId:         row.user_id,
      username:       row.username,
      avatarUrl:      row.avatar ?? twitchAvatar ?? null,
      twitchId:       row.twitch_id,
      twitchLogin:    row.twitch_login,
      messageCount:   parseInt(row.message_count, 10) || 0,
      eventCount:     parseInt(row.event_count, 10) || 0,
      lastActivityAt: lastActivityMs > 0 ? new Date(lastActivityMs).toISOString() : null,
      linkedAt:       row.linked_at,
    }
  })
}

// Côté admin, unlink direct sans passer par le user concerné. On garde
// l'opération réversible (le viewer peut re-link via Flow A).
export async function adminUnlinkViewer(userId: string): Promise<boolean> {
  const r = await db.query<{ id: string }>(
    `UPDATE users SET twitch_id = NULL, twitch_login = NULL, updated_at = NOW()
     WHERE id = $1 AND twitch_id IS NOT NULL
     RETURNING id`,
    [userId],
  )
  return r.rows.length > 0
}
