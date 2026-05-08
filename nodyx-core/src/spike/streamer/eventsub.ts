// ─── Streamer Hub spike — EventSub webhook handler ───────────────────────────
// POST /api/v1/integrations/twitch/eventsub/:nonce
//
// Le `:nonce` est l'URL-secret généré à la souscription (§12.2). On l'utilise
// pour retrouver le shared secret HMAC à utiliser pour vérifier la signature.
//
// Vérifications dans l'ordre (une seule échoue = 4xx silencieux pour ne rien
// révéler au caller) :
//   1. nonce existe en mémoire
//   2. headers Twitch présents
//   3. dedupe message_id (Redis 24h)
//   4. HMAC SHA-256 valide
//   5. dispatch selon Twitch-Eventsub-Message-Type
//
// Critique : la HMAC est calculée sur le BODY BRUT (pas le JSON parsé). On lit
// le raw body via un content-type parser custom — Fastify v5 expose ça
// proprement avec `request.rawBody` une fois enregistré.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { redis } from '../../config/database'
import {
  findSubscriptionByNonce,
  readHmacSecret,
  markSubscriptionStatus,
} from './store'

const DEDUPE_PREFIX  = 'streamer:spike:eventsub:msgid:'
const DEDUPE_TTL_SEC = 24 * 3600

const HEADER_MSG_ID    = 'twitch-eventsub-message-id'
const HEADER_TIMESTAMP = 'twitch-eventsub-message-timestamp'
const HEADER_SIGNATURE = 'twitch-eventsub-message-signature'
const HEADER_TYPE      = 'twitch-eventsub-message-type'

const MSG_TYPE_VERIFICATION = 'webhook_callback_verification'
const MSG_TYPE_NOTIFICATION = 'notification'
const MSG_TYPE_REVOCATION   = 'revocation'

function readHeader(request: FastifyRequest, name: string): string | null {
  const v = request.headers[name]
  if (typeof v === 'string') return v
  if (Array.isArray(v))      return v[0] ?? null
  return null
}

function verifyHmac(args: {
  secret:    string
  messageId: string
  timestamp: string
  rawBody:   string
  signature: string  // format: "sha256=<hex>"
}): boolean {
  if (!args.signature.startsWith('sha256=')) return false
  const expectedHex = createHmac('sha256', args.secret)
    .update(args.messageId)
    .update(args.timestamp)
    .update(args.rawBody)
    .digest('hex')
  const provided = Buffer.from(args.signature.slice('sha256='.length), 'hex')
  const expected = Buffer.from(expectedHex, 'hex')
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

// Plugin Fastify encapsulé : le content-type parser custom ci-dessous reste
// scopé à ce plugin (Fastify v5 encapsule addContentTypeParser par défaut).
// Aucun autre handler de nodyx-core n'est affecté.
export const eventsubPlugin: FastifyPluginAsync = async (server) => {
  // On garde le body brut pour le calcul HMAC. Le parser par défaut JSON
  // casse l'idempotence du calcul (formatting whitespace différent du wire).
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const parsed = body.length ? JSON.parse(body as string) : {}
      ;(parsed as Record<string, unknown>).__rawBody = body
      done(null, parsed)
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  server.post('/eventsub/:nonce', async (request, reply) => {
    const params = request.params as { nonce: string }

    const sub = findSubscriptionByNonce(params.nonce)
    if (!sub) {
      // 404 silencieux — ne révèle pas si le nonce a existé. Pas de log verbeux
      // pour ne pas faciliter un scan.
      return reply.code(404).send()
    }

    const messageId = readHeader(request, HEADER_MSG_ID)
    const timestamp = readHeader(request, HEADER_TIMESTAMP)
    const signature = readHeader(request, HEADER_SIGNATURE)
    const msgType   = readHeader(request, HEADER_TYPE)
    if (!messageId || !timestamp || !signature || !msgType) {
      return reply.code(400).send({ error: 'missing_headers' })
    }

    // Dedupe — si on a déjà vu ce message_id en 24h, on renvoie 204 sans rejouer.
    // SETNX + EXPIRE atomique via SET NX EX.
    const dedupeKey = DEDUPE_PREFIX + messageId
    const fresh     = await redis.set(dedupeKey, '1', 'EX', DEDUPE_TTL_SEC, 'NX')
    if (fresh !== 'OK') {
      request.log.info({ messageId }, 'EventSub dupe absorbed')
      return reply.code(204).send()
    }

    // HMAC vérification — la sécurité primaire (§12.2)
    const body    = request.body as Record<string, unknown> & { __rawBody?: string }
    const rawBody = body?.__rawBody ?? ''
    const secret  = readHmacSecret(sub)
    const valid = verifyHmac({ secret, messageId, timestamp, rawBody, signature })
    if (!valid) {
      // Effacer le dedupe : un signature-fail ne doit pas bloquer un retry légitime
      await redis.del(dedupeKey).catch(() => {})
      request.log.warn({ messageId, nonce: params.nonce.slice(0, 8) + '…' }, 'EventSub HMAC invalid')
      return reply.code(403).send()
    }

    // Dispatch selon le type
    if (msgType === MSG_TYPE_VERIFICATION) {
      const challenge = (body as { challenge?: string }).challenge
      if (typeof challenge !== 'string') {
        return reply.code(400).send({ error: 'missing_challenge' })
      }
      markSubscriptionStatus(sub.externalSubId, 'enabled')
      request.log.info({ subId: sub.externalSubId, eventType: sub.eventType }, 'EventSub verification OK → enabled')
      return reply
        .code(200)
        .header('content-type', 'text/plain; charset=utf-8')
        .send(challenge)
    }

    if (msgType === MSG_TYPE_NOTIFICATION) {
      const evt = (body as { event?: unknown; subscription?: { type?: string } })
      request.log.info({
        subId:       sub.externalSubId,
        eventType:   evt.subscription?.type ?? sub.eventType,
        event:       evt.event,
      }, '🎬 EventSub notification reçue')
      // Phase 0 : on logge et c'est tout. Phase 1 : INSERT streamer_events + dispatch.
      return reply.code(204).send()
    }

    if (msgType === MSG_TYPE_REVOCATION) {
      markSubscriptionStatus(sub.externalSubId, 'revoked')
      request.log.warn({
        subId:  sub.externalSubId,
        reason: (body as { subscription?: { status?: string } }).subscription?.status,
      }, 'EventSub revoked by Twitch')
      return reply.code(204).send()
    }

    request.log.warn({ msgType }, 'EventSub message type inconnu')
    return reply.code(400).send({ error: 'unknown_message_type' })
  })
}
