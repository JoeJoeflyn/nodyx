// ─── Streamer Hub — EventSub subscriptions service ──────────────────────────
// Public API:
//   createSubscription(args)             → row publique (nonce + provider info)
//   findByNonce(nonce)                   → row publique
//   findByExternalSubId(provider, id)    → row publique
//   readHmacSecret(rowId)                → string clear (en mémoire only)
//   markStatus(externalSubId, status, ...) → mise à jour transitions
//   listSubscriptions(provider?)         → row[]
//   deleteSubscription(rowId)            → bool
//
// Une subscription = 1 row par (provider × event_type), avec un nonce dédié
// dans son URL callback (/eventsub/{nonce}). Le nonce permet de retrouver
// le bon secret HMAC sans exposer un endpoint global devinable (§12.2).

import { db } from '../../config/database'
import { encrypt, decrypt } from './crypto'
import { audit } from './audit'
import type { ProviderId } from './providers/_types'
import { randomBytes } from 'node:crypto'

interface SubRowDb {
  id:                string
  provider:          ProviderId
  external_sub_id:   string
  event_type:        string
  callback_nonce:    string
  hmac_secret_enc:   Buffer
  hmac_salt:         Buffer
  hmac_iv:           Buffer
  hmac_tag:          Buffer
  hmac_kver:         number
  status:            'pending' | 'enabled' | 'revoked' | 'failed'
  created_at:        Date
  enabled_at:        Date | null
  revoked_at:        Date | null
}

export interface EventSubRow {
  id:             string
  provider:       ProviderId
  externalSubId:  string
  eventType:      string
  callbackNonce:  string
  status:         SubRowDb['status']
  createdAt:      Date
  enabledAt:      Date | null
  revokedAt:      Date | null
}

function rowToPublic(row: SubRowDb): EventSubRow {
  return {
    id:            row.id,
    provider:      row.provider,
    externalSubId: row.external_sub_id,
    eventType:     row.event_type,
    callbackNonce: row.callback_nonce,
    status:        row.status,
    createdAt:     row.created_at,
    enabledAt:     row.enabled_at,
    revokedAt:     row.revoked_at,
  }
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createSubscription(args: {
  provider:      ProviderId
  externalSubId: string
  eventType:     string
  hmacSecret:    string
}): Promise<EventSubRow> {
  const callbackNonce = randomBytes(32).toString('base64url')
  const blob = encrypt(args.hmacSecret)

  const result = await db.query<SubRowDb>(
    `INSERT INTO streamer_eventsub_subscriptions
       (provider, external_sub_id, event_type, callback_nonce,
        hmac_secret_enc, hmac_salt, hmac_iv, hmac_tag, hmac_kver,
        status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
     ON CONFLICT (provider, event_type) DO UPDATE SET
       external_sub_id = EXCLUDED.external_sub_id,
       callback_nonce  = EXCLUDED.callback_nonce,
       hmac_secret_enc = EXCLUDED.hmac_secret_enc,
       hmac_salt       = EXCLUDED.hmac_salt,
       hmac_iv         = EXCLUDED.hmac_iv,
       hmac_tag        = EXCLUDED.hmac_tag,
       hmac_kver       = EXCLUDED.hmac_kver,
       status          = 'pending',
       created_at      = NOW(),
       enabled_at      = NULL,
       revoked_at      = NULL
     RETURNING *`,
    [
      args.provider,
      args.externalSubId,
      args.eventType,
      callbackNonce,
      blob.ciphertext, blob.salt, blob.iv, blob.tag, blob.keyVersion,
    ],
  )

  await audit({
    action:    'eventsub_subscribe',
    status:    'success',
    metadata:  {
      provider:      args.provider,
      eventType:     args.eventType,
      externalSubId: args.externalSubId,
    },
  })

  return rowToPublic(result.rows[0])
}

// ── Lookup ───────────────────────────────────────────────────────────────────

export async function findByNonce(nonce: string): Promise<EventSubRow | null> {
  const result = await db.query<SubRowDb>(
    `SELECT * FROM streamer_eventsub_subscriptions WHERE callback_nonce = $1`,
    [nonce],
  )
  if (!result.rows.length) return null
  return rowToPublic(result.rows[0])
}

export async function findByExternalSubId(
  provider: ProviderId,
  externalSubId: string,
): Promise<EventSubRow | null> {
  const result = await db.query<SubRowDb>(
    `SELECT * FROM streamer_eventsub_subscriptions
     WHERE provider = $1 AND external_sub_id = $2`,
    [provider, externalSubId],
  )
  if (!result.rows.length) return null
  return rowToPublic(result.rows[0])
}

export async function listSubscriptions(provider?: ProviderId): Promise<EventSubRow[]> {
  const result = provider
    ? await db.query<SubRowDb>(
        `SELECT * FROM streamer_eventsub_subscriptions WHERE provider = $1 ORDER BY created_at DESC`,
        [provider],
      )
    : await db.query<SubRowDb>(
        `SELECT * FROM streamer_eventsub_subscriptions ORDER BY created_at DESC`,
      )
  return result.rows.map(rowToPublic)
}

// ── HMAC secret read (in-memory only, JAMAIS persister le clear) ───────────

export async function readHmacSecretByNonce(nonce: string): Promise<string | null> {
  const result = await db.query<SubRowDb>(
    `SELECT * FROM streamer_eventsub_subscriptions WHERE callback_nonce = $1`,
    [nonce],
  )
  if (!result.rows.length) return null
  const row = result.rows[0]
  try {
    return decrypt({
      ciphertext: row.hmac_secret_enc,
      salt:       row.hmac_salt,
      iv:         row.hmac_iv,
      tag:        row.hmac_tag,
      keyVersion: row.hmac_kver,
    })
  } catch (err) {
    await audit({
      action:   'token_decrypt_failed',
      status:   'failed',
      metadata: { what: 'eventsub_hmac_secret', nonce: nonce.slice(0, 8) + '…' },
      error:    (err as Error).message,
    })
    return null
  }
}

// ── Status transitions ───────────────────────────────────────────────────────
// On adresse les rows par leur id DB (pas par external_sub_id), parce que
// Twitch envoie le webhook verification avant que notre UPDATE post-create-API
// n'ait écrit le vrai external_sub_id. Le rowId est stable depuis l'INSERT.

export async function markEnabledById(rowId: string): Promise<void> {
  await db.query(
    `UPDATE streamer_eventsub_subscriptions
     SET status = 'enabled', enabled_at = NOW()
     WHERE id = $1 AND status != 'revoked'`,
    [rowId],
  )
}

export async function markRevokedById(rowId: string, reason?: string): Promise<void> {
  const result = await db.query<{ external_sub_id: string; provider: ProviderId }>(
    `UPDATE streamer_eventsub_subscriptions
     SET status = 'revoked', revoked_at = NOW()
     WHERE id = $1
     RETURNING external_sub_id, provider`,
    [rowId],
  )
  const row = result.rows[0]
  await audit({
    action:    'eventsub_revoked',
    status:    'success',
    metadata:  {
      provider:      row?.provider,
      externalSubId: row?.external_sub_id,
      reason:        reason ?? null,
    },
  })
}

export async function markFailedById(rowId: string): Promise<void> {
  await db.query(
    `UPDATE streamer_eventsub_subscriptions
     SET status = 'failed'
     WHERE id = $1`,
    [rowId],
  )
}

// Set le vrai external_sub_id reçu de Twitch après l'API call. Appelé depuis
// streamerHubService.subscribeAllStreamerEvents juste après response Twitch.
export async function setExternalSubId(rowId: string, externalSubId: string): Promise<void> {
  await db.query(
    `UPDATE streamer_eventsub_subscriptions
     SET external_sub_id = $1
     WHERE id = $2`,
    [externalSubId, rowId],
  )
}

export async function deleteSubscription(rowId: string): Promise<boolean> {
  const result = await db.query<{ external_sub_id: string; provider: ProviderId }>(
    `DELETE FROM streamer_eventsub_subscriptions WHERE id = $1
     RETURNING external_sub_id, provider`,
    [rowId],
  )
  return result.rows.length > 0
}
