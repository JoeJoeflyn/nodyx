// ─── Streamer Hub — Leaderboard state aggregator ───────────────────────────
// Calcule le top N viewers selon catégorie + période. Source : streamer_events
// (table déjà alimentée par tous les events EventSub).
//
//   - subs     : COUNT events channel.subscribe + subscription.gift
//                groupé par chatter (user_id du gifter ou de l'abonné)
//   - bits     : SUM bits des channel.cheer, exclus anonymes
//   - raids    : COUNT channel.raid groupé par from_broadcaster
//   - chatters : COUNT channel.chat.message groupé par chatter_user_id
//
// Le name affiché vient du payload de l'event (user_name / chatter_user_name).
// Les avatars sont résolus en batch via twitchAvatars en fin de calcul.

import { db } from '../../config/database'
import { resolveAvatars, resolveAvatarsByLogin } from './twitchAvatars'
import type { LeaderboardCategory, LeaderboardConfig, LeaderboardPeriod } from './overlayService'

export interface LeaderboardEntry {
  userId:    string         // twitch user_id
  userName:  string         // display name au moment du calcul
  score:     number         // count ou sum selon la catégorie
  avatarUrl: string | null
}

interface RawAggRow {
  user_id:    string
  user_name:  string
  score:      string         // bigint cast en text par pg
}

async function getOpenSessionStart(): Promise<string | null> {
  const r = await db.query<{ started_at: string }>(
    `SELECT started_at FROM streamer_sessions
     WHERE provider = 'twitch' AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
  ).catch(() => null)
  return r?.rows[0]?.started_at ?? null
}

function buildTimeClause(period: LeaderboardPeriod, sessionStart: string | null): { clause: string; param: string | null } {
  switch (period) {
    case 'session':
      return sessionStart
        ? { clause: 'AND occurred_at >= $1', param: sessionStart }
        : { clause: 'AND FALSE',             param: null }    // pas de session = pas de résultats
    case '7d':
      return { clause: `AND occurred_at >= NOW() - INTERVAL '7 days'`,  param: null }
    case '30d':
      return { clause: `AND occurred_at >= NOW() - INTERVAL '30 days'`, param: null }
    case 'all':
    default:
      return { clause: '', param: null }
  }
}

// SQL helper : prend la "shape" de la catégorie et construit la requête.
// Chaque catégorie pointe vers un user_id différent dans le payload :
//   - subs     : payload.event.user_id (l'abonné) + name = user_name
//   - bits     : payload.event.user_id (le cheerer, exclu si is_anonymous=true) + bits = (payload.event.bits)::int
//   - raids    : payload.event.from_broadcaster_user_id + name = from_broadcaster_user_name
//   - chatters : payload.event.chatter_user_id + name = chatter_user_name

interface CategorySpec {
  eventTypes:  string[]            // valeurs autorisées de event_type
  userIdPath:  string              // expression PG pour extraire user_id du payload
  namePath:    string              // expression PG pour le nom
  extraWhere?: string              // filtres SQL supplémentaires (ex: exclure anonymes)
  scoreExpr:   string              // expression COUNT(*) ou SUM(...)
}

const SPECS: Record<LeaderboardCategory, CategorySpec> = {
  subs: {
    eventTypes:  ['channel.subscribe', 'channel.subscription.gift'],
    userIdPath:  `payload->'event'->>'user_id'`,
    namePath:    `payload->'event'->>'user_name'`,
    scoreExpr:   `COUNT(*)`,
  },
  bits: {
    eventTypes:  ['channel.cheer'],
    userIdPath:  `payload->'event'->>'user_id'`,
    namePath:    `payload->'event'->>'user_name'`,
    extraWhere:  `AND (payload->'event'->>'is_anonymous')::boolean IS NOT TRUE`,
    scoreExpr:   `SUM((payload->'event'->>'bits')::bigint)`,
  },
  raids: {
    eventTypes:  ['channel.raid'],
    userIdPath:  `payload->'event'->>'from_broadcaster_user_id'`,
    namePath:    `payload->'event'->>'from_broadcaster_user_name'`,
    scoreExpr:   `COUNT(*)`,
  },
  chatters: {
    eventTypes:  ['channel.chat.message'],
    userIdPath:  `payload->'event'->>'chatter_user_id'`,
    namePath:    `payload->'event'->>'chatter_user_name'`,
    scoreExpr:   `COUNT(*)`,
  },
}

export interface LeaderboardState {
  category:    LeaderboardCategory
  period:      LeaderboardPeriod
  entries:     LeaderboardEntry[]   // longueur ≤ topN
  totalCount:  number               // nb total de participants (avant truncation à topN)
  generatedAt: string
}

// Chatters utilise une source DIFFÉRENTE : les messages chat ne sont pas
// persistés dans streamer_events (volume trop élevé, cf streamerHubService.ts
// ligne 624). Ils vivent dans channel_messages avec author_id pointant vers
// le user Nodyx (ghost "tw_<login>" ou linked Flow A). On joint users pour
// le nom + avatar (déjà stocké au moment de la création du ghost).
async function computeChattersLeaderboard(cfg: LeaderboardConfig): Promise<LeaderboardState> {
  const sessionStart = cfg.period === 'session' ? await getOpenSessionStart() : null
  const time = buildTimeClause(cfg.period, sessionStart)

  // Time clause sur created_at au lieu de occurred_at
  const sqlParams: unknown[] = []
  let finalTimeClause = ''
  if (time.clause === 'AND FALSE') {
    finalTimeClause = 'AND FALSE'
  } else if (time.param) {
    sqlParams.push(time.param)
    finalTimeClause = `AND m.created_at >= $${sqlParams.length}`
  } else if (cfg.period === '7d') {
    finalTimeClause = `AND m.created_at >= NOW() - INTERVAL '7 days'`
  } else if (cfg.period === '30d') {
    finalTimeClause = `AND m.created_at >= NOW() - INTERVAL '30 days'`
  }

  const sql = `
    SELECT
      m.author_id::text AS user_id,
      u.username        AS user_name,
      u.avatar          AS avatar_url,
      COUNT(*)::text    AS score
    FROM channel_messages m
    JOIN users    u ON u.id = m.author_id
    JOIN channels c ON c.id = m.channel_id
    WHERE c.slug = 'twitch-chat'
      ${finalTimeClause}
    GROUP BY m.author_id, u.username, u.avatar
    ORDER BY COUNT(*) DESC
    LIMIT ${Math.max(3, Math.min(20, cfg.topN))}
  `

  const r = await db.query<{ user_id: string; user_name: string; avatar_url: string | null; score: string }>(
    sql, sqlParams,
  ).catch(() => null)
  const rows = r?.rows ?? []

  // Pour les ghost users (username = "tw_<login>") on a aucun avatar en DB.
  // On résout via Helix /users?login=<login> en batch (cache Redis 24h).
  // Les vrais users Nodyx (Flow A linked) gardent leur avatar local s'il
  // existe, sinon on tente aussi par login s'ils ont un twitch_login dispo.
  const ghostLogins: string[] = []
  for (const row of rows) {
    if (!row.avatar_url && row.user_name?.startsWith('tw_')) {
      ghostLogins.push(row.user_name.slice(3).toLowerCase())
    }
  }
  const ghostAvatars = ghostLogins.length > 0
    ? await resolveAvatarsByLogin(ghostLogins).catch(() => new Map<string, string>())
    : new Map<string, string>()

  const entries: LeaderboardEntry[] = rows.map(row => {
    const isGhost  = row.user_name?.startsWith('tw_') ?? false
    const login    = isGhost ? row.user_name.slice(3).toLowerCase() : ''
    const userName = isGhost ? row.user_name.slice(3) : (row.user_name ?? 'Anonyme')
    const avatar   = row.avatar_url ?? (isGhost ? ghostAvatars.get(login) ?? null : null)
    return {
      userId:    row.user_id,
      userName,
      score:     parseInt(row.score, 10) || 0,
      avatarUrl: avatar,
    }
  })

  return {
    category:    cfg.category,
    period:      cfg.period,
    entries,
    totalCount:  entries.length,
    generatedAt: new Date().toISOString(),
  }
}

export async function computeLeaderboard(cfg: LeaderboardConfig): Promise<LeaderboardState> {
  // Chatters a sa propre source (channel_messages, pas streamer_events)
  if (cfg.category === 'chatters') return computeChattersLeaderboard(cfg)

  const spec = SPECS[cfg.category]
  const sessionStart = cfg.period === 'session' ? await getOpenSessionStart() : null
  const time = buildTimeClause(cfg.period, sessionStart)

  // $1 = eventTypes array. Si la période a un cutoff temporel paramétrable
  // (session avec started_at), on l'injecte en $2 et on remap le clause.
  const sqlParams: unknown[] = [spec.eventTypes]
  let finalTimeClause = ''
  if (time.clause === 'AND FALSE') {
    finalTimeClause = 'AND FALSE'
  } else if (time.param) {
    sqlParams.push(time.param)
    finalTimeClause = `AND occurred_at >= $2`
  } else {
    finalTimeClause = time.clause
  }

  // user_id NON null pour exclure les events sans identifiant exploitable
  // (chat.message system, anonymes filtrés via extraWhere, etc).
  const sql = `
    SELECT
      ${spec.userIdPath}                                       AS user_id,
      COALESCE(
        (array_agg(${spec.namePath} ORDER BY occurred_at DESC))[1],
        'Anonyme'
      )                                                        AS user_name,
      ${spec.scoreExpr}::text                                  AS score
    FROM streamer_events
    WHERE provider = 'twitch'
      AND event_type = ANY($1::text[])
      AND (external_id IS NULL OR external_id NOT LIKE 'test-%')
      AND ${spec.userIdPath} IS NOT NULL
      ${spec.extraWhere ?? ''}
      ${finalTimeClause}
    GROUP BY ${spec.userIdPath}
    ORDER BY ${spec.scoreExpr} DESC
    LIMIT ${Math.max(3, Math.min(20, cfg.topN))}
  `

  const r = await db.query<RawAggRow>(sql, sqlParams).catch(() => null)
  const rows = r?.rows ?? []

  // Résolution batch des avatars en 1 seul appel helix (déjà cached pour les
  // events récents grâce à ingestEvent → enrichEventWithAvatar)
  const userIds = rows.map(row => row.user_id).filter(Boolean)
  const avatars = userIds.length > 0
    ? await resolveAvatars(userIds).catch(() => new Map<string, string>())
    : new Map<string, string>()

  const entries: LeaderboardEntry[] = rows.map(row => ({
    userId:    row.user_id,
    userName:  row.user_name ?? 'Anonyme',
    score:     parseInt(row.score, 10) || 0,
    avatarUrl: avatars.get(row.user_id) ?? null,
  }))

  return {
    category:    cfg.category,
    period:      cfg.period,
    entries,
    totalCount:  entries.length,
    generatedAt: new Date().toISOString(),
  }
}
