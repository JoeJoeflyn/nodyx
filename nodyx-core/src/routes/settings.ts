/**
 * NODYX — Admin settings routes (spec 017)
 * Panneau de configuration : permet à l'admin d'éditer la config de l'instance
 * depuis l'UI au lieu du .env en SSH. Toutes les routes requièrent adminOnly.
 * Prefix : /api/v1/admin/settings
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adminOnly } from '../middleware/adminOnly'
import { rateLimit } from '../middleware/rateLimit'
import { validate } from '../middleware/validate'
import { getEffectiveSettings, setSettings } from '../config/settings'

const PutBody = z.object({
  updates: z.record(z.string(), z.unknown()),
})

export default async function settingsRoutes(app: FastifyInstance) {
  // GET — liste des réglages éditables + valeurs effectives (secrets masqués).
  app.get('/', { preHandler: [rateLimit, adminOnly] }, async (_request, reply) => {
    return reply.send({ settings: getEffectiveSettings() })
  })

  // PUT — applique un lot de modifications. Valide d'abord ; si une seule clé
  // est invalide, on rejette TOUT le lot (pas d'application partielle).
  app.put('/', {
    preHandler: [rateLimit, adminOnly, validate({ body: PutBody })],
  }, async (request, reply) => {
    const { updates } = request.body as z.infer<typeof PutBody>
    const result = await setSettings(updates, request.user?.userId ?? null)
    if (!result.ok) {
      return reply.code(400).send({ ok: false, errors: result.errors })
    }
    return reply.send({
      ok:              true,
      applied:         result.applied,
      restartRequired: result.restartRequired,
    })
  })

  // POST /test/twitch — vérifie les credentials Twitch courants (client_credentials
  // grant). Utilise les valeurs déjà appliquées dans process.env (donc reflète ce
  // qui vient d'être sauvé). Ne renvoie jamais le secret.
  app.post('/test/twitch', { preHandler: [rateLimit, adminOnly] }, async (_request, reply) => {
    const clientId     = process.env.TWITCH_CLIENT_ID
    const clientSecret = process.env.TWITCH_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      return reply.code(400).send({ ok: false, message: 'Client ID et Client Secret requis' })
    }
    try {
      const res = await fetch('https://id.twitch.tv/oauth2/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     clientId,
          client_secret: clientSecret,
          grant_type:    'client_credentials',
        }),
      })
      if (res.ok) return reply.send({ ok: true, message: 'Identifiants Twitch valides' })
      const body = await res.json().catch(() => ({})) as { message?: string }
      return reply.code(400).send({ ok: false, message: body.message ?? `Twitch a refusé (HTTP ${res.status})` })
    } catch {
      return reply.code(502).send({ ok: false, message: 'Impossible de contacter Twitch' })
    }
  })
}
