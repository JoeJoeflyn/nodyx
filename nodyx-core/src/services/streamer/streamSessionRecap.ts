// ─── Streamer Hub — Recap de fin de stream ─────────────────────────────────
// Agrège les stats d'une session (top chatters depuis channel_messages, top
// cheerers + counts events depuis streamer_events) pour pouvoir construire
// un message récap publié dans #streamer-events à la fin du live.
//
// Tous les compteurs sont bornés à la fenêtre [started_at, ended_at] de la
// session de streamer_sessions.

import { db } from '../../config/database'
import { resolveAvatarsByLogin } from './twitchAvatars'

export interface RecapTopEntry {
  name:   string
  score:  number
  avatar: string | null
}

export interface StreamRecap {
  startedAt:        string
  endedAt:          string
  topChatters:      RecapTopEntry[]      // top 3 par messages count
  totalMessages:    number
  topBitsDonors:    RecapTopEntry[]      // top 3 par sum bits
  totalBits:        number
  subsCount:        number               // subscribe + subscription.gift events
  giftSubsTotal:    number               // somme des "total" sur les gifts
  raidsCount:       number
  raidersTotalViewers: number            // somme des viewers entrant via raids
  followersCount:   number               // nouveaux follows pendant la session
}

const TOP_N = 3

interface TopChatterRow { author_id: string; user_name: string; avatar_url: string | null; score: string }
interface TopBitsRow    { user_id: string;   user_name: string;                            score: string }

export async function computeStreamRecap(args: {
  startedAt: string
  endedAt:   string
}): Promise<StreamRecap> {

  // ── 1. Top chatters depuis channel_messages (channel = twitch-chat) ──
  const chattersSql = `
    SELECT
      m.author_id::text AS author_id,
      u.username        AS user_name,
      u.avatar          AS avatar_url,
      COUNT(*)::text    AS score
    FROM channel_messages m
    JOIN users    u ON u.id = m.author_id
    JOIN channels c ON c.id = m.channel_id
    WHERE c.slug = 'twitch-chat'
      AND m.created_at >= $1
      AND m.created_at <= $2
    GROUP BY m.author_id, u.username, u.avatar
    ORDER BY COUNT(*) DESC
    LIMIT ${TOP_N}
  `
  const chatTotalSql = `
    SELECT COUNT(*)::text AS total
    FROM channel_messages m
    JOIN channels c ON c.id = m.channel_id
    WHERE c.slug = 'twitch-chat'
      AND m.created_at >= $1 AND m.created_at <= $2
  `

  // ── 2. Top cheerers depuis streamer_events (channel.cheer) ──
  // Exclus anonymes pour le podium (mais on les compte dans total)
  const bitsSql = `
    SELECT
      payload->'event'->>'user_id'                                AS user_id,
      COALESCE(
        (array_agg(payload->'event'->>'user_name' ORDER BY occurred_at DESC))[1],
        'Anonyme'
      )                                                            AS user_name,
      SUM((payload->'event'->>'bits')::bigint)::text              AS score
    FROM streamer_events
    WHERE provider = 'twitch'
      AND event_type = 'channel.cheer'
      AND (external_id IS NULL OR external_id NOT LIKE 'test-%')
      AND occurred_at >= $1 AND occurred_at <= $2
      AND (payload->'event'->>'is_anonymous')::boolean IS NOT TRUE
      AND payload->'event'->>'user_id' IS NOT NULL
    GROUP BY payload->'event'->>'user_id'
    ORDER BY SUM((payload->'event'->>'bits')::bigint) DESC
    LIMIT ${TOP_N}
  `
  const bitsTotalSql = `
    SELECT COALESCE(SUM((payload->'event'->>'bits')::bigint), 0)::text AS total
    FROM streamer_events
    WHERE provider = 'twitch'
      AND event_type = 'channel.cheer'
      AND (external_id IS NULL OR external_id NOT LIKE 'test-%')
      AND occurred_at >= $1 AND occurred_at <= $2
  `

  // ── 3. Counts agrégés (subs, raids, followers) ──
  const subsSql = `
    SELECT
      COUNT(*) FILTER (WHERE event_type = 'channel.subscribe')                    AS subs_count,
      COALESCE(SUM(
        CASE WHEN event_type = 'channel.subscription.gift'
        THEN (payload->'event'->>'total')::int ELSE 0 END
      ), 0)                                                                       AS gift_total
    FROM streamer_events
    WHERE provider = 'twitch'
      AND event_type IN ('channel.subscribe', 'channel.subscription.gift')
      AND (external_id IS NULL OR external_id NOT LIKE 'test-%')
      AND occurred_at >= $1 AND occurred_at <= $2
  `
  const raidsSql = `
    SELECT
      COUNT(*)                                                                    AS raids_count,
      COALESCE(SUM((payload->'event'->>'viewers')::int), 0)                       AS viewers_total
    FROM streamer_events
    WHERE provider = 'twitch'
      AND event_type = 'channel.raid'
      AND (external_id IS NULL OR external_id NOT LIKE 'test-%')
      AND occurred_at >= $1 AND occurred_at <= $2
  `
  const followsSql = `
    SELECT COUNT(*) AS count
    FROM streamer_events
    WHERE provider = 'twitch'
      AND event_type = 'channel.follow'
      AND (external_id IS NULL OR external_id NOT LIKE 'test-%')
      AND occurred_at >= $1 AND occurred_at <= $2
  `

  const [chatters, chatTotal, bits, bitsTotal, subs, raids, follows] = await Promise.all([
    db.query<TopChatterRow>(chattersSql, [args.startedAt, args.endedAt]).then(r => r.rows).catch(() => [] as TopChatterRow[]),
    db.query<{ total: string }>(chatTotalSql, [args.startedAt, args.endedAt]).then(r => parseInt(r.rows[0]?.total ?? '0', 10)).catch(() => 0),
    db.query<TopBitsRow>(bitsSql, [args.startedAt, args.endedAt]).then(r => r.rows).catch(() => [] as TopBitsRow[]),
    db.query<{ total: string }>(bitsTotalSql, [args.startedAt, args.endedAt]).then(r => parseInt(r.rows[0]?.total ?? '0', 10)).catch(() => 0),
    db.query<{ subs_count: string; gift_total: string }>(subsSql, [args.startedAt, args.endedAt]).then(r => r.rows[0] ?? { subs_count: '0', gift_total: '0' }).catch(() => ({ subs_count: '0', gift_total: '0' })),
    db.query<{ raids_count: string; viewers_total: string }>(raidsSql, [args.startedAt, args.endedAt]).then(r => r.rows[0] ?? { raids_count: '0', viewers_total: '0' }).catch(() => ({ raids_count: '0', viewers_total: '0' })),
    db.query<{ count: string }>(followsSql, [args.startedAt, args.endedAt]).then(r => parseInt(r.rows[0]?.count ?? '0', 10)).catch(() => 0),
  ])

  // Résout les avatars des ghost chatters via Helix login lookup
  const ghostLogins: string[] = []
  for (const row of chatters) {
    if (!row.avatar_url && row.user_name?.startsWith('tw_')) {
      ghostLogins.push(row.user_name.slice(3).toLowerCase())
    }
  }
  const ghostAvatars = ghostLogins.length > 0
    ? await resolveAvatarsByLogin(ghostLogins).catch(() => new Map<string, string>())
    : new Map<string, string>()

  const topChatters: RecapTopEntry[] = chatters.map(row => {
    const isGhost = row.user_name?.startsWith('tw_') ?? false
    const login   = isGhost ? row.user_name.slice(3).toLowerCase() : ''
    return {
      name:   isGhost ? row.user_name.slice(3) : (row.user_name ?? 'Anonyme'),
      score:  parseInt(row.score, 10) || 0,
      avatar: row.avatar_url ?? (isGhost ? (ghostAvatars.get(login) ?? null) : null),
    }
  })

  const topBitsDonors: RecapTopEntry[] = bits.map(row => ({
    name:   row.user_name,
    score:  parseInt(row.score, 10) || 0,
    avatar: null,   // streamer_events ne stocke pas l'avatar, on pourrait helix mais c'est plus de complexité
  }))

  return {
    startedAt:           args.startedAt,
    endedAt:             args.endedAt,
    topChatters,
    totalMessages:       chatTotal,
    topBitsDonors,
    totalBits:           bitsTotal,
    subsCount:           parseInt(subs.subs_count, 10) || 0,
    giftSubsTotal:       parseInt(subs.gift_total, 10) || 0,
    raidsCount:          parseInt(raids.raids_count, 10) || 0,
    raidersTotalViewers: parseInt(raids.viewers_total, 10) || 0,
    followersCount:      follows,
  }
}
