// ─── Streamer Hub — token service (DB-backed) ───────────────────────────────
// Public API:
//   saveStreamerTokens(args)          → row publique
//   findStreamerByExternalId(provider, externalId)
//   findPrimaryStreamer(provider)     → le streamer "owner" du hub
//   listStreamers(provider?)
//   getDecryptedTokens(rowId)         → { accessToken, refreshToken, ... }
//   refreshAndPersist({ provider, rowId })
//   revokeTokens({ rowId })
//
// Tokens chiffrés AES-256-GCM avec HKDF(master, salt) par row (§12.1).
// Access et refresh ont chacun leur propre triplet (salt, iv, tag) pour que
// GCM reste correct (jamais 2 IV identiques sous la même clé dérivée).

import { db } from '../../config/database'
import { encrypt, decrypt } from './crypto'
import { ProviderError, type StreamerProvider, type ProviderId } from './providers/_types'
import { audit } from './audit'

interface TokenRowDb {
  id:                string
  provider:          ProviderId
  user_id:           string | null
  external_id:       string
  external_login:    string
  access_token_enc:  Buffer
  access_salt:       Buffer
  access_iv:         Buffer
  access_tag:        Buffer
  refresh_token_enc: Buffer
  refresh_salt:      Buffer
  refresh_iv:        Buffer
  refresh_tag:       Buffer
  key_version:       number
  scopes:            string[]
  expires_at:        Date
  is_streamer:       boolean
  rotated_at:        Date
  created_at:        Date
  updated_at:        Date
}

export interface StreamerTokenRow {
  id:             string
  provider:       ProviderId
  userId:         string | null
  externalId:     string
  externalLogin:  string
  scopes:         string[]
  expiresAt:      Date
  isStreamer:     boolean
  rotatedAt:      Date
}

function rowToPublic(row: TokenRowDb): StreamerTokenRow {
  return {
    id:            row.id,
    provider:      row.provider,
    userId:        row.user_id,
    externalId:    row.external_id,
    externalLogin: row.external_login,
    scopes:        row.scopes,
    expiresAt:     row.expires_at,
    isStreamer:    row.is_streamer,
    rotatedAt:     row.rotated_at,
  }
}

// ── Save / upsert ────────────────────────────────────────────────────────────

export async function saveStreamerTokens(args: {
  provider:      ProviderId
  userId:        string | null
  externalId:    string
  externalLogin: string
  accessToken:   string
  refreshToken:  string
  scopes:        string[]
  expiresAt:     Date
  isStreamer:    boolean
}): Promise<StreamerTokenRow> {
  const accessBlob  = encrypt(args.accessToken)
  const refreshBlob = encrypt(args.refreshToken)

  // Les deux blobs partagent la même key_version (master key actuelle au
  // moment de l'écriture). En Phase 5 lors d'une rotation, on re-chiffre les
  // deux ensemble et on bump key_version atomiquement.
  if (accessBlob.keyVersion !== refreshBlob.keyVersion) {
    throw new Error('saveStreamerTokens: keyVersion mismatch entre access et refresh blobs')
  }

  const result = await db.query<TokenRowDb>(
    `INSERT INTO streamer_oauth_tokens
       (provider, user_id, external_id, external_login,
        access_token_enc, access_salt, access_iv, access_tag,
        refresh_token_enc, refresh_salt, refresh_iv, refresh_tag,
        key_version, scopes, expires_at, is_streamer,
        rotated_at, updated_at)
     VALUES ($1, $2, $3, $4,
             $5, $6, $7, $8,
             $9, $10, $11, $12,
             $13, $14, $15, $16,
             NOW(), NOW())
     ON CONFLICT (provider, external_id) DO UPDATE SET
       user_id           = EXCLUDED.user_id,
       external_login    = EXCLUDED.external_login,
       access_token_enc  = EXCLUDED.access_token_enc,
       access_salt       = EXCLUDED.access_salt,
       access_iv         = EXCLUDED.access_iv,
       access_tag        = EXCLUDED.access_tag,
       refresh_token_enc = EXCLUDED.refresh_token_enc,
       refresh_salt      = EXCLUDED.refresh_salt,
       refresh_iv        = EXCLUDED.refresh_iv,
       refresh_tag       = EXCLUDED.refresh_tag,
       key_version       = EXCLUDED.key_version,
       scopes            = EXCLUDED.scopes,
       expires_at        = EXCLUDED.expires_at,
       is_streamer       = streamer_oauth_tokens.is_streamer OR EXCLUDED.is_streamer,
       rotated_at        = NOW(),
       updated_at        = NOW()
     RETURNING *`,
    [
      args.provider,
      args.userId,
      args.externalId,
      args.externalLogin,
      accessBlob.ciphertext,  accessBlob.salt,  accessBlob.iv,  accessBlob.tag,
      refreshBlob.ciphertext, refreshBlob.salt, refreshBlob.iv, refreshBlob.tag,
      accessBlob.keyVersion,
      args.scopes,
      args.expiresAt,
      args.isStreamer,
    ],
  )

  return rowToPublic(result.rows[0])
}

// ── Find ─────────────────────────────────────────────────────────────────────

export async function findStreamerByExternalId(
  provider: ProviderId,
  externalId: string,
): Promise<StreamerTokenRow | null> {
  const result = await db.query<TokenRowDb>(
    `SELECT * FROM streamer_oauth_tokens WHERE provider = $1 AND external_id = $2`,
    [provider, externalId],
  )
  if (!result.rows.length) return null
  return rowToPublic(result.rows[0])
}

export async function findPrimaryStreamer(provider: ProviderId): Promise<StreamerTokenRow | null> {
  const result = await db.query<TokenRowDb>(
    `SELECT * FROM streamer_oauth_tokens
     WHERE provider = $1 AND is_streamer = TRUE
     ORDER BY updated_at DESC LIMIT 1`,
    [provider],
  )
  if (!result.rows.length) return null
  return rowToPublic(result.rows[0])
}

export async function listStreamers(provider?: ProviderId): Promise<StreamerTokenRow[]> {
  const result = provider
    ? await db.query<TokenRowDb>(`SELECT * FROM streamer_oauth_tokens WHERE provider = $1 ORDER BY created_at DESC`, [provider])
    : await db.query<TokenRowDb>(`SELECT * FROM streamer_oauth_tokens ORDER BY created_at DESC`)
  return result.rows.map(rowToPublic)
}

// ── Decrypt (en mémoire uniquement, ne JAMAIS persister le clear) ──────────

interface DecryptedTokenPair {
  accessToken:   string
  refreshToken:  string
  expiresAt:     Date
  scopes:        string[]
  externalLogin: string
}

export async function getDecryptedTokens(rowId: string): Promise<DecryptedTokenPair | null> {
  const result = await db.query<TokenRowDb>(
    `SELECT * FROM streamer_oauth_tokens WHERE id = $1`,
    [rowId],
  )
  if (!result.rows.length) return null
  const row = result.rows[0]

  try {
    const accessToken = decrypt({
      ciphertext: row.access_token_enc,
      salt:       row.access_salt,
      iv:         row.access_iv,
      tag:        row.access_tag,
      keyVersion: row.key_version,
    })
    const refreshToken = decrypt({
      ciphertext: row.refresh_token_enc,
      salt:       row.refresh_salt,
      iv:         row.refresh_iv,
      tag:        row.refresh_tag,
      keyVersion: row.key_version,
    })
    return {
      accessToken,
      refreshToken,
      expiresAt:     row.expires_at,
      scopes:        row.scopes,
      externalLogin: row.external_login,
    }
  } catch (err) {
    await audit({
      action:   'token_decrypt_failed',
      status:   'failed',
      userId:   row.user_id,
      metadata: { rowId, externalLogin: row.external_login },
      error:    (err as Error).message,
    })
    return null
  }
}

// ── Refresh proactif (§12.3) ─────────────────────────────────────────────────

export async function refreshAndPersist(args: {
  provider: StreamerProvider
  rowId:    string
  userId?:  string | null
  ip?:      string | null
}): Promise<StreamerTokenRow | null> {
  const decrypted = await getDecryptedTokens(args.rowId)
  if (!decrypted) return null

  let refreshed
  try {
    refreshed = await args.provider.refreshTokens(decrypted.refreshToken)
  } catch (err) {
    const status = err instanceof ProviderError ? err.status : 0
    await audit({
      action:    'refresh_token',
      status:    'failed',
      userId:    args.userId,
      ipAddress: args.ip,
      metadata:  { rowId: args.rowId, twitchStatus: status },
      error:     (err as Error).message,
    })
    throw err
  }

  // Re-fetch row pour conserver externalId / login / userId / isStreamer
  const fresh = await db.query<TokenRowDb>(
    `SELECT external_id, external_login, user_id, is_streamer
     FROM streamer_oauth_tokens WHERE id = $1`,
    [args.rowId],
  )
  if (!fresh.rows.length) return null
  const row = fresh.rows[0]

  const saved = await saveStreamerTokens({
    provider:      args.provider.id,
    userId:        row.user_id,
    externalId:    row.external_id,
    externalLogin: row.external_login,
    accessToken:   refreshed.accessToken,
    refreshToken:  refreshed.refreshToken,
    scopes:        refreshed.scopes,
    expiresAt:     new Date(Date.now() + refreshed.expiresIn * 1000),
    isStreamer:    row.is_streamer,
  })

  await audit({
    action:    'refresh_token',
    status:    'success',
    userId:    args.userId,
    ipAddress: args.ip,
    metadata:  { rowId: args.rowId, externalLogin: row.external_login },
  })

  return saved
}

// ── Revoke (delete + audit) ──────────────────────────────────────────────────

export async function revokeTokens(args: {
  rowId:   string
  userId?: string | null
  ip?:     string | null
}): Promise<boolean> {
  const result = await db.query<{ external_login: string }>(
    `DELETE FROM streamer_oauth_tokens WHERE id = $1 RETURNING external_login`,
    [args.rowId],
  )
  const deleted = result.rows.length > 0
  await audit({
    action:    'disconnect_twitch',
    status:    deleted ? 'success' : 'failed',
    userId:    args.userId,
    ipAddress: args.ip,
    metadata:  { rowId: args.rowId, externalLogin: result.rows[0]?.external_login },
  })
  return deleted
}
