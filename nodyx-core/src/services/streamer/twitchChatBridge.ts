// ─── Streamer Hub — outbound chat bridge (Nodyx → Twitch) ──────────────────
// Quand un membre Nodyx écrit dans le channel #twitch-chat, on relaie le
// message vers le chat Twitch via Helix POST /chat/messages.
//
// Convention :
//   - Le message est POST avec sender_id = broadcaster_id = streamer Twitch.
//     Le streamer "héberge" donc tous les messages relayés. Phase futur :
//     si le user Nodyx a son Twitch lié avec user:write:chat, poster comme
//     lui (plus authentique mais demande plus de scopes côté viewer).
//   - Le contenu est préfixé par [NodyxAuthor] pour que les viewers Twitch
//     comprennent que ce n'est pas le streamer qui écrit directement.
//   - Garde-fou §6.4 : on ne relaie QUE si le streamer est actuellement en
//     live (streamer_sessions.ended_at IS NULL). Sinon on persiste côté
//     Nodyx mais on ne spam pas un chat offline. Mode test (env var) bypass.

import { db } from '../../config/database'
import { findPrimaryStreamer, getDecryptedTokens, refreshAndPersist } from './tokenService'
import { audit } from './audit'
import { twitchProvider } from './providers/twitchProvider'
import type { ProviderId } from './providers/_types'

// Le préfixe peut être désactivé via env si l'admin veut une expérience plus
// "pure bridge" (les messages apparaissent comme venant du streamer sans
// indication). Par défaut on préfixe pour la transparence.
const RELAY_PREFIX_DISABLED = process.env.STREAMER_CHAT_NO_PREFIX === '1'
// Mode test : bypass le check stream live pour faciliter le smoke testing.
// À NE PAS activer en prod stable. Pour un streamer qui veut tester son
// pipeline avant un go-live, c'est utile.
const RELAY_TEST_MODE = process.env.STREAMER_CHAT_TEST_MODE === '1'

// ── Stream live check (§6.4) ────────────────────────────────────────────────

async function isStreamerLive(broadcasterExternalId: string): Promise<boolean> {
  if (RELAY_TEST_MODE) return true
  const r = await db.query<{ id: string }>(
    `SELECT id FROM streamer_sessions
     WHERE provider = 'twitch' AND external_id IS NOT NULL
       AND ended_at IS NULL
     LIMIT 1`,
  )
  // Note : pour la 1ère version, on check juste qu'il y a UNE session ouverte
  // (provider == 'twitch'). En Phase 1 on ne crée pas encore de row dans
  // streamer_sessions à stream.online (c'était spec mais pas implémenté).
  // Conséquence : isStreamerLive retournera FALSE → no-op outbound. C'est
  // un blocker à fixer (créer streamer_sessions à stream.online).
  void broadcasterExternalId
  return r.rows.length > 0
}

// ── Helix POST /chat/messages (Twitch send) ─────────────────────────────────

interface HelixSendChatResponse {
  data?: Array<{
    message_id:  string
    is_sent:     boolean
    drop_reason?: { code: string; message: string } | null
  }>
}

async function postTwitchChatMessage(args: {
  userAccessToken: string
  broadcasterId:   string
  senderId:        string
  message:         string
}): Promise<{ ok: true; messageId: string } | { ok: false; reason: string }> {
  const clientId = process.env.STREAMER_TWITCH_CLIENT_ID
  if (!clientId) return { ok: false, reason: 'no_client_id' }

  const res = await fetch('https://api.twitch.tv/helix/chat/messages', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${args.userAccessToken}`,
      'Client-Id':     clientId,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      broadcaster_id: args.broadcasterId,
      sender_id:      args.senderId,
      message:        args.message,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    return { ok: false, reason: `http_${res.status}:${body.slice(0, 200)}` }
  }

  const data = await res.json() as HelixSendChatResponse
  const sent = data.data?.[0]
  if (!sent) return { ok: false, reason: 'empty_response' }
  if (!sent.is_sent) {
    return { ok: false, reason: `dropped:${sent.drop_reason?.code ?? 'unknown'}` }
  }
  return { ok: true, messageId: sent.message_id }
}

// ── Token freshness ─────────────────────────────────────────────────────────
// Le user access token Twitch dure ~4h. On refresh proactivement quand il
// expirera dans < 5 min pour éviter un 401 en pleine session de stream.

async function getValidStreamerAccessToken(): Promise<{ token: string; broadcasterId: string } | null> {
  const primary = await findPrimaryStreamer('twitch')
  if (!primary) return null

  const REFRESH_MARGIN_MS = 5 * 60 * 1000
  const expiresInMs = primary.expiresAt.getTime() - Date.now()
  if (expiresInMs < REFRESH_MARGIN_MS) {
    try {
      await refreshAndPersist({ provider: twitchProvider, rowId: primary.id })
    } catch (err) {
      console.error('[twitchChatBridge] refresh failed', err)
      return null
    }
  }

  const decrypted = await getDecryptedTokens(primary.id)
  if (!decrypted) return null
  return { token: decrypted.accessToken, broadcasterId: primary.externalId }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface RelayResult {
  ok:     boolean
  reason?: string  // 'stream_offline', 'no_streamer', 'twitch_error', etc.
}

export async function relayMessageToTwitch(args: {
  provider:       ProviderId  // toujours 'twitch' pour Phase 2
  authorUsername: string      // le user Nodyx qui a écrit
  authorUserId:   string | null  // pour audit (peut être null si bot/system)
  text:           string
}): Promise<RelayResult> {
  if (args.provider !== 'twitch') return { ok: false, reason: 'unsupported_provider' }

  const tok = await getValidStreamerAccessToken()
  if (!tok) {
    return { ok: false, reason: 'no_streamer' }
  }

  const live = await isStreamerLive(tok.broadcasterId)
  if (!live) {
    // Persisté côté Nodyx mais non relayé. On ne logue pas en audit pour
    // éviter le bruit (chaque message Nodyx sans stream live générerait une
    // ligne audit). C'est un état attendu.
    return { ok: false, reason: 'stream_offline' }
  }

  // Format : "[NodyxAuthor] message".
  // Twitch limite les messages à 500 chars. On tronque proprement.
  const prefix  = RELAY_PREFIX_DISABLED ? '' : `[${args.authorUsername}] `
  const message = (prefix + args.text).slice(0, 500)

  const result = await postTwitchChatMessage({
    userAccessToken: tok.token,
    broadcasterId:   tok.broadcasterId,
    senderId:        tok.broadcasterId,  // stream poste comme lui-même (Phase 2 v1)
    message,
  })

  if (result.ok) {
    return { ok: true }
  }

  // Échec : on logue en audit pour diagnostic mais on n'échoue pas l'appel
  // initial. Le message reste persisté côté Nodyx, le user voit son message
  // dans #twitch-chat même si Twitch a refusé.
  await audit({
    action:    'eventsub_subscribe',  // pas le meilleur slot, on créera un
                                      // 'chat_relay_failed' plus tard si besoin
    status:    'failed',
    userId:    args.authorUserId,
    metadata:  {
      kind:           'chat_relay_to_twitch',
      reason:         result.reason,
      authorUsername: args.authorUsername,
      textLength:     message.length,
    },
  })
  return { ok: false, reason: result.reason }
}

// Export pour tests ou usage admin debug
export const _testInternals = { isStreamerLive, postTwitchChatMessage }
