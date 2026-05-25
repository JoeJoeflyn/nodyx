// ─── Streamer Hub — Socket.IO namespace pour les overlays OBS ──────────────
// Les overlays sont des pages publiques (URL avec token) qui tournent dans
// OBS. Elles n'ont pas de JWT user, donc on les fait passer par un namespace
// séparé `/overlay` avec sa propre auth middleware basée sur le token row.
//
// Rooms par socket :
//   - overlay:<id>          → push de config spécifique à cet overlay
//   - overlay-type:<type>   → broadcast par type (alert_box reçoit tous les
//                              events follow/sub/raid/cheer)
//
// Dispatch côté event ingest : voir streamerHubService.ingestEvent qui
// appelle dispatchEventToOverlays() après persistence.

import type { Server, Socket } from 'socket.io'
import { findOverlayByToken, touchOverlayLastSeen, type OverlayType } from '../services/streamer/overlayService'

export const OVERLAY_NS = '/overlay'

export function registerOverlayNamespace(server: Server): void {
  const ns = server.of(OVERLAY_NS)

  // Auth middleware : valide le token côté DB. Si revoked → reject.
  ns.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) return next(new Error('Missing token'))

    const overlay = await findOverlayByToken(token).catch(() => null)
    if (!overlay) return next(new Error('Invalid or revoked token'))

    socket.data.overlayId   = overlay.id
    socket.data.overlayType = overlay.overlayType
    next()
  })

  ns.on('connection', (socket: Socket) => {
    const overlayId   = socket.data.overlayId as string
    const overlayType = socket.data.overlayType as OverlayType

    socket.join(`overlay:${overlayId}`)
    socket.join(`overlay-type:${overlayType}`)

    // Trace last connection pour le debug admin ("dernière connexion OBS").
    touchOverlayLastSeen(overlayId).catch(() => {})

    // Ack côté client pour qu'il sache qu'il est bien sub.
    socket.emit('overlay:ready', { overlayId, overlayType })
  })
}

// ── Dispatch — appelé depuis ingestEvent quand un event Twitch arrive ──────
// On expose une API simple pour que la couche service ne dépende pas de
// Socket.IO directement (testabilité).

export interface OverlayEvent {
  kind:        OverlayType            // type d'overlay à qui c'est destiné
  eventType:   string                  // ex: 'channel.follow'
  payload:     Record<string, unknown>
  occurredAt:  string
}

export function dispatchOverlayEvent(server: Server, evt: OverlayEvent): void {
  const ns = server.of(OVERLAY_NS)
  ns.to(`overlay-type:${evt.kind}`).emit('overlay:event', evt)
}
