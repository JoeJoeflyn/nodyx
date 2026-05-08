// ─── Streamer Hub spike — entry point ────────────────────────────────────────
// Phase 0 isolée du sanctuaire nodyx-core/src/routes/. Ce dossier est jeté ou
// promu après validation Phase 0 (cf docs/specs/015-streamer-hub/SPEC.MD §13).
//
// Wired dans src/index.ts derrière `STREAMER_SPIKE_ENABLED=1`. Sans la flag,
// aucune route n'est enregistrée, aucun import n'est exécuté.

import type { FastifyPluginAsync } from 'fastify'
import { oauthPlugin }    from './oauth'
import { eventsubPlugin } from './eventsub'

// Plugin parent : encapsule oauth + eventsub sous deux préfixes différents.
// Le contenu-type parser custom de eventsub reste scopé à eventsubPlugin.
const streamerSpikePlugin: FastifyPluginAsync = async (server) => {
  await server.register(oauthPlugin,    { prefix: '/api/v1/streamer/twitch' })
  await server.register(eventsubPlugin, { prefix: '/api/v1/integrations/twitch' })

  server.log.info('🧪 Streamer Hub spike chargé (oauth + eventsub)')
}

export default streamerSpikePlugin
