<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { page } from '$app/stores'
	import { browser } from '$app/environment'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { fly, fade } from 'svelte/transition'

	// Page transparente conçue pour être collée comme Browser Source dans OBS.
	// Aucun chrome, aucune nav, aucun auth user. Le token dans l'URL EST l'auth :
	// il bootstrappe la config via REST et ouvre la socket overlay namespace.
	//
	// Pour ce slice 1, on affiche un texte simple en haut à droite qui glisse
	// pendant 5 secondes puis disparait. La polish (avatars, sons, custom
	// templates) viendra au slice 2.

	const token = $derived(($page.params as { token: string }).token)

	type AlertItem = {
		id:        string
		eventType: string
		message:   string
		color:     string   // accent
		shownAt:   number
	}

	let alerts   = $state<AlertItem[]>([])
	let status   = $state<'loading' | 'ready' | 'invalid' | 'error'>('loading')
	let overlay  = $state<{ id: string; overlayType: string; label: string | null } | null>(null)

	const SHOW_DURATION_MS = 5000

	// ── Bootstrap : valide le token via REST puis ouvre la socket ────────────

	async function bootstrap(): Promise<void> {
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/streamer/overlay/lookup/${token}`)
			if (!res.ok) { status = 'invalid'; return }
			const data = await res.json() as { ok: boolean; overlay: { id: string; overlayType: string; label: string | null } }
			if (!data.ok || data.overlay.overlayType !== 'alert_box') { status = 'invalid'; return }
			overlay = data.overlay
			openSocket()
		} catch {
			status = 'error'
		}
	}

	let socket: { disconnect: () => void } | null = null

	async function openSocket(): Promise<void> {
		// Import dynamique pour SSR-safety
		const { io } = await import('socket.io-client')
		// Connect on /overlay namespace with token in handshake auth
		const s = io(`${PUBLIC_API_URL}/overlay`, {
			auth:       { token },
			transports: ['polling', 'websocket'],
			path:       '/socket.io/',
		})
		s.on('connect',         () => { status = 'ready' })
		s.on('connect_error',   () => { status = 'invalid' })
		s.on('disconnect',      () => { /* swallow */ })
		s.on('overlay:ready',   () => { status = 'ready' })
		s.on('overlay:event',   (evt: { eventType: string; payload: Record<string, { event?: Record<string, unknown> }> }) => {
			const item = buildAlertItem(evt)
			if (item) pushAlert(item)
		})
		socket = s
	}

	onMount(() => {
		if (browser) bootstrap()
	})

	onDestroy(() => {
		if (socket) socket.disconnect()
	})

	// ── Construction du message à afficher ───────────────────────────────────

	function buildAlertItem(evt: { eventType: string; payload: { event?: Record<string, unknown> } }): AlertItem | null {
		const e = (evt.payload?.event ?? {}) as Record<string, unknown>
		const id = `${evt.eventType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

		switch (evt.eventType) {
			case 'channel.follow':
				return {
					id, eventType: evt.eventType,
					message: `${e.user_name ?? e.user_login ?? 'Anonyme'} a follow !`,
					color:   '#06b6d4',
					shownAt: Date.now(),
				}
			case 'channel.subscribe': {
				const tier = String(e.tier ?? '').replace('000', '') || '1'
				return {
					id, eventType: evt.eventType,
					message: `${e.user_name ?? '?'} s'abonne (tier ${tier})${e.is_gift ? ' offert !' : ' !'}`,
					color:   '#a855f7',
					shownAt: Date.now(),
				}
			}
			case 'channel.subscription.gift':
				return {
					id, eventType: evt.eventType,
					message: `${e.user_name ?? 'Anonyme'} offre ${e.total ?? 1} sub${(e.total as number ?? 1) > 1 ? 's' : ''} !`,
					color:   '#ec4899',
					shownAt: Date.now(),
				}
			case 'channel.cheer':
				return {
					id, eventType: evt.eventType,
					message: `${e.is_anonymous ? 'Anonyme' : e.user_name ?? '?'} envoie ${e.bits ?? 0} bits !`,
					color:   '#f59e0b',
					shownAt: Date.now(),
				}
			case 'channel.raid':
				return {
					id, eventType: evt.eventType,
					message: `Raid de ${e.from_broadcaster_user_name ?? '?'} avec ${e.viewers ?? 0} viewers !`,
					color:   '#ef4444',
					shownAt: Date.now(),
				}
			default:
				return null
		}
	}

	function pushAlert(item: AlertItem): void {
		alerts = [...alerts, item]
		// Auto-dismiss
		setTimeout(() => {
			alerts = alerts.filter(a => a.id !== item.id)
		}, SHOW_DURATION_MS)
	}
</script>

<svelte:head>
	<title>Overlay alert box</title>
	<style>
		html, body {
			background: transparent !important;
			margin:     0;
			padding:    0;
			overflow:   hidden;
			height:     100vh;
		}
	</style>
</svelte:head>

<div class="overlay-root">
	{#if status === 'invalid'}
		<div class="status-msg status-error" transition:fade>
			Overlay invalide ou révoquée. Génère une nouvelle URL dans Nodyx.
		</div>
	{:else if status === 'error'}
		<div class="status-msg status-error" transition:fade>
			Connexion Nodyx impossible. Vérifie ta connexion réseau.
		</div>
	{:else if status === 'loading'}
		<div class="status-msg status-info" transition:fade>
			Connexion à Nodyx…
		</div>
	{/if}

	{#each alerts as alert (alert.id)}
		<div class="alert-card" style="border-color: {alert.color}; box-shadow: 0 8px 32px {alert.color}40;"
		     in:fly={{ x: 400, duration: 400 }} out:fade={{ duration: 300 }}>
			<div class="alert-bar" style="background: {alert.color}"></div>
			<div class="alert-content">
				<div class="alert-eyebrow" style="color: {alert.color}">Nouveau !</div>
				<div class="alert-message">{alert.message}</div>
			</div>
		</div>
	{/each}
</div>

<style>
	.overlay-root {
		position: fixed;
		top: 24px;
		right: 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: flex-end;
		pointer-events: none;
		font-family: 'Geist', -apple-system, system-ui, sans-serif;
		max-width: 480px;
	}

	.alert-card {
		display: flex;
		min-width: 320px;
		max-width: 480px;
		background: rgba(15, 23, 42, 0.92);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-left-width: 3px;
		border-radius: 10px;
		overflow: hidden;
	}

	.alert-bar {
		width: 4px;
		flex-shrink: 0;
	}

	.alert-content {
		padding: 12px 16px;
		flex: 1;
	}

	.alert-eyebrow {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		margin-bottom: 4px;
	}

	.alert-message {
		color: #f1f5f9;
		font-size: 15px;
		font-weight: 600;
		line-height: 1.35;
	}

	.status-msg {
		padding: 8px 14px;
		border-radius: 8px;
		font-size: 12px;
		font-weight: 500;
		font-family: 'Geist', -apple-system, sans-serif;
	}

	.status-info {
		background: rgba(15, 23, 42, 0.85);
		color: #94a3b8;
		border: 1px solid rgba(148, 163, 184, 0.2);
	}

	.status-error {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
		border: 1px solid rgba(239, 68, 68, 0.4);
	}
</style>
