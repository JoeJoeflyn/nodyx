<script lang="ts">
	// Listener invisible monté dans le layout racine. Si l'utilisateur courant
	// est owner / admin, joint la room admin:streamer-hub via Socket.IO et joue
	// le son configuré (settings → Notifications Streamer) sur chaque
	// streamer:event reçu. Permet au streamer qui a coupé son retour OBS
	// d'être notifié dans Nodyx (ou sur son tel/tablette via le Deck).

	import { onDestroy } from 'svelte'
	import { socket } from '$lib/socket'
	import { playStreamerNotif } from '$lib/sounds/streamerNotifSettings'
	import type { Socket } from 'socket.io-client'

	interface Props {
		role: string | null | undefined   // 'owner' | 'admin' | autre
	}

	let { role }: Props = $props()

	let joined = false
	let attachedSocket: Socket | null = null

	function onStreamerEvent(ev: unknown): void {
		const e = ev as { eventType?: unknown }
		const t = typeof e?.eventType === 'string' ? e.eventType : ''
		if (!t) return
		playStreamerNotif(t)
	}

	const unsub = socket.subscribe(s => {
		const isAdmin = role === 'owner' || role === 'admin'
		// Détache du précédent (en cas de reconnexion / changement)
		if (attachedSocket && attachedSocket !== s) {
			try { attachedSocket.off('streamer:event', onStreamerEvent) } catch { /* ignore */ }
			attachedSocket = null
			joined = false
		}
		if (!s || !isAdmin) return
		attachedSocket = s
		if (!joined) {
			try { s.emit('streamer-hub:join') } catch { /* ignore */ }
			joined = true
		}
		s.on('streamer:event', onStreamerEvent)
	})

	onDestroy(() => {
		unsub()
		if (attachedSocket) {
			try { attachedSocket.off('streamer:event', onStreamerEvent) } catch { /* ignore */ }
			try { attachedSocket.emit('streamer-hub:leave') } catch { /* ignore */ }
		}
	})
</script>
