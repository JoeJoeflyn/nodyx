<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { page } from '$app/stores'
	import { browser } from '$app/environment'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { fade } from 'svelte/transition'

	// Stream timer overlay : affiche le temps écoulé depuis le started_at de
	// la session en cours. Bootstrap l'état via REST, tick local chaque
	// seconde, écoute stream.online (reset depuis le nouveau started_at) et
	// stream.offline (cache l'overlay).
	//
	// Pour ce slice, position fixe (haut-gauche) et style sobre. La
	// personnalisation (position, couleur, taille, formatage) viendra dans
	// le slice 2 via la config JSONB.

	const token = $derived(($page.params as { token: string }).token)

	type State = { isLive: boolean; startedAt: string | null }

	let status   = $state<'loading' | 'ready' | 'invalid' | 'error'>('loading')
	let isLive   = $state(false)
	let startedAt = $state<string | null>(null)
	let now      = $state(Date.now())
	let tickTimer: ReturnType<typeof setInterval> | null = null
	let socket: { disconnect: () => void } | null = null

	async function bootstrap(): Promise<void> {
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/streamer/overlay/lookup/${token}`)
			if (!res.ok) { status = 'invalid'; return }
			const data = await res.json() as {
				ok: boolean
				overlay: { overlayType: string; state?: State | null }
			}
			if (!data.ok || data.overlay.overlayType !== 'stream_timer') { status = 'invalid'; return }

			const s = data.overlay.state
			if (s) { isLive = s.isLive; startedAt = s.startedAt }
			status = 'ready'
			openSocket()
			startTicking()
		} catch {
			status = 'error'
		}
	}

	async function openSocket(): Promise<void> {
		const { io } = await import('socket.io-client')
		const s = io(`${PUBLIC_API_URL}/overlay`, {
			auth:       { token },
			transports: ['polling', 'websocket'],
			path:       '/socket.io/',
		})
		s.on('overlay:event', (evt: { eventType: string; payload: { event?: Record<string, unknown> }; occurredAt: string }) => {
			if (evt.eventType === 'stream.online') {
				// payload.event.started_at est l'ISO Twitch. Fallback sur occurredAt
				// au cas où le payload arrive dégradé.
				const e = evt.payload?.event ?? {}
				const sa = (e.started_at as string | undefined) ?? evt.occurredAt
				startedAt = sa
				isLive    = true
			} else if (evt.eventType === 'stream.offline') {
				isLive    = false
				startedAt = null
			}
		})
		socket = s
	}

	function startTicking(): void {
		if (tickTimer) clearInterval(tickTimer)
		tickTimer = setInterval(() => { now = Date.now() }, 1000)
	}

	onMount(() => { if (browser) bootstrap() })
	onDestroy(() => {
		if (tickTimer) clearInterval(tickTimer)
		if (socket)    socket.disconnect()
	})

	// ── Formatting ───────────────────────────────────────────────────────────

	const elapsedMs = $derived(
		isLive && startedAt
			? Math.max(0, now - new Date(startedAt).getTime())
			: 0,
	)

	function formatHMS(ms: number): string {
		const totalSec = Math.floor(ms / 1000)
		const h = Math.floor(totalSec / 3600)
		const m = Math.floor((totalSec % 3600) / 60)
		const s = totalSec % 60
		const mm = m.toString().padStart(2, '0')
		const ss = s.toString().padStart(2, '0')
		return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
	}
</script>

<svelte:head>
	<title>Overlay stream timer</title>
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
			Overlay invalide ou révoquée.
		</div>
	{:else if status === 'error'}
		<div class="status-msg status-error" transition:fade>
			Connexion Nodyx impossible.
		</div>
	{:else if status === 'ready' && isLive}
		<div class="timer-card" transition:fade>
			<span class="dot"></span>
			<span class="timer-text">{formatHMS(elapsedMs)}</span>
		</div>
	{/if}
</div>

<style>
	.overlay-root {
		position: fixed;
		top: 24px;
		left: 24px;
		font-family: 'Geist', -apple-system, system-ui, sans-serif;
		pointer-events: none;
	}

	.timer-card {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 8px 14px 8px 12px;
		background: rgba(15, 23, 42, 0.78);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(244, 63, 94, 0.35);
		border-radius: 999px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
	}

	.timer-text {
		font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
		font-size: 22px;
		font-weight: 700;
		color: #f1f5f9;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.5px;
	}

	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #f43f5e;
		box-shadow: 0 0 0 4px rgba(244, 63, 94, 0.18);
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1;    box-shadow: 0 0 0 4px rgba(244, 63, 94, 0.18); }
		50%      { opacity: 0.7;  box-shadow: 0 0 0 8px rgba(244, 63, 94, 0.06); }
	}

	.status-msg {
		padding: 8px 14px;
		border-radius: 8px;
		font-size: 12px;
		font-weight: 500;
	}
	.status-error {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
		border: 1px solid rgba(239, 68, 68, 0.4);
	}
</style>
