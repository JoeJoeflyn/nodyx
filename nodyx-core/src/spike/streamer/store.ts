// ─── Streamer Hub spike — stockage minimal ───────────────────────────────────
// Phase 0 : pas de DB, pas de migration. Tokens en mémoire (fichier process),
// state CSRF dans Redis avec TTL court. Tout est jeté au restart.
//
// Phase 1 reprendra ces shapes pour les coller dans `streamer_oauth_tokens`
// et `streamer_eventsub_subscriptions` (cf §3 spec).

import { redis } from '../../config/database'
import { encrypt, decrypt, type EncryptedBlob } from './crypto'

const STATE_PREFIX        = 'streamer:spike:oauth:state:'
const STATE_TTL_SECONDS   = 600  // 10 min, le user a tout son temps pour cliquer "Authorize"

// ── State CSRF (OAuth) ───────────────────────────────────────────────────────

export interface OAuthState {
  createdAt: number
  ip:        string
}

import { randomBytes } from 'node:crypto'

export async function createState(ip: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const payload: OAuthState = { createdAt: Date.now(), ip }
  await redis.set(STATE_PREFIX + token, JSON.stringify(payload), 'EX', STATE_TTL_SECONDS)
  return token
}

export async function consumeState(token: string): Promise<OAuthState | null> {
  const key   = STATE_PREFIX + token
  const value = await redis.get(key)
  if (!value) return null
  await redis.del(key)  // single-use
  try { return JSON.parse(value) as OAuthState }
  catch { return null }
}

// ── Tokens streamer (in-memory, jeté au restart) ─────────────────────────────

export interface StoredTokens {
  externalId:    string         // Twitch user_id
  externalLogin: string         // Twitch login
  scopes:        string[]
  expiresAt:     number         // epoch ms
  rotatedAt:     number         // epoch ms — dernière rotation forcée
  accessBlob:    EncryptedBlob
  refreshBlob:   EncryptedBlob
}

const tokens = new Map<string, StoredTokens>()  // key = externalId

export function saveTokens(args: {
  externalId:    string
  externalLogin: string
  scopes:        string[]
  expiresAt:     number
  accessToken:   string
  refreshToken:  string
}): StoredTokens {
  const blob: StoredTokens = {
    externalId:    args.externalId,
    externalLogin: args.externalLogin,
    scopes:        args.scopes,
    expiresAt:     args.expiresAt,
    rotatedAt:     Date.now(),
    accessBlob:    encrypt(args.accessToken),
    refreshBlob:   encrypt(args.refreshToken),
  }
  tokens.set(args.externalId, blob)
  return blob
}

export function getTokens(externalId: string): StoredTokens | null {
  return tokens.get(externalId) ?? null
}

export function readAccessToken(blob: StoredTokens): string {
  return decrypt(blob.accessBlob)
}

export function readRefreshToken(blob: StoredTokens): string {
  return decrypt(blob.refreshBlob)
}

export function listAllStreamers(): { externalId: string; externalLogin: string; expiresAt: number }[] {
  return Array.from(tokens.values()).map(t => ({
    externalId:    t.externalId,
    externalLogin: t.externalLogin,
    expiresAt:     t.expiresAt,
  }))
}

// ── EventSub subscriptions (in-memory + nonce → secret HMAC) ─────────────────

export interface StoredSubscription {
  externalSubId: string
  eventType:     string
  callbackNonce: string  // dans l'URL : /eventsub/{nonce}
  hmacBlob:      EncryptedBlob
  status:        'pending' | 'enabled' | 'revoked' | 'failed'
  createdAt:     number
}

const subscriptionsByNonce = new Map<string, StoredSubscription>()
const subscriptionsBySubId = new Map<string, StoredSubscription>()

export function saveSubscription(args: {
  externalSubId: string
  eventType:     string
  hmacSecret:    string
  status:        StoredSubscription['status']
}): StoredSubscription {
  const callbackNonce = randomBytes(32).toString('base64url')
  const sub: StoredSubscription = {
    externalSubId: args.externalSubId,
    eventType:     args.eventType,
    callbackNonce,
    hmacBlob:      encrypt(args.hmacSecret),
    status:        args.status,
    createdAt:     Date.now(),
  }
  subscriptionsByNonce.set(callbackNonce, sub)
  subscriptionsBySubId.set(args.externalSubId, sub)
  return sub
}

export function findSubscriptionByNonce(nonce: string): StoredSubscription | null {
  return subscriptionsByNonce.get(nonce) ?? null
}

export function readHmacSecret(sub: StoredSubscription): string {
  return decrypt(sub.hmacBlob)
}

export function markSubscriptionStatus(externalSubId: string, status: StoredSubscription['status']): void {
  const sub = subscriptionsBySubId.get(externalSubId)
  if (sub) sub.status = status
}

export function listSubscriptions(): StoredSubscription[] {
  return Array.from(subscriptionsByNonce.values())
}
