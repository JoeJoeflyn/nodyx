<script lang="ts">
	import { page } from '$app/stores'
	import { invalidateAll } from '$app/navigation'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	type Subscription = {
		id:             string
		eventType:      string
		status:         'pending' | 'enabled' | 'revoked' | 'failed'
		externalSubId:  string
		callbackNonce:  string
		createdAt:      string
		enabledAt:      string | null
		revokedAt:      string | null
	}

	type StreamerRow = {
		id:             string
		externalId:     string
		externalLogin:  string
		scopes:         string[]
		expiresAt:      string
		isStreamer:     boolean
		rotatedAt:      string
	}

	type RecentEvent = {
		id:         string
		provider:   string
		eventType:  string
		payload:    { event?: Record<string, unknown>; subscription?: Record<string, unknown> }
		occurredAt: string
	}

	let connecting    = $state(false)
	let refreshing    = $state(false)
	let disconnecting = $state(false)
	let syncing       = $state(false)
	let helpOpen      = $state(false)
	let toast         = $state<{ text: string; ok: boolean } | null>(null)

	const primary       = $derived<StreamerRow | null>(data.primaryStreamer)
	const isConnected   = $derived(!!primary)
	const subs          = $derived<Subscription[]>(data.subscriptions ?? [])
	const enabledCount  = $derived(subs.filter(s => s.status === 'enabled').length)
	const failedCount   = $derived(subs.filter(s => s.status === 'failed').length)
	const pendingCount  = $derived(subs.filter(s => s.status === 'pending').length)
	const events        = $derived<RecentEvent[]>(data.recentEvents ?? [])
	const lastEvent     = $derived(events[0] ?? null)

	// Token expiry in ms (negative = expired). Used to color the metric card.
	const tokenExpiresInMs = $derived(primary ? new Date(primary.expiresAt).getTime() - Date.now() : 0)
	const tokenHealth = $derived(
		!primary             ? 'idle'    :
		tokenExpiresInMs < 0 ? 'down'    :
		tokenExpiresInMs < 30 * 60 * 1000 ? 'warning' : 'ok'
	)
	const subsHealth = $derived(
		!primary           ? 'idle'    :
		failedCount  > 0   ? 'down'    :
		pendingCount > 0   ? 'warning' :
		enabledCount > 0   ? 'ok'      : 'idle'
	)
	const activityHealth = $derived(
		!lastEvent  ? 'idle' :
		(Date.now() - new Date(lastEvent.occurredAt).getTime()) < 6 * 60 * 60 * 1000 ? 'ok' : 'warning'
	)

	function pushToast(text: string, ok: boolean) {
		toast = { text, ok }
		setTimeout(() => { if (toast?.text === text) toast = null }, 3500)
	}

	function authHeaders(): Record<string, string> {
		const token = $page.data.token as string | null
		return token ? { 'Authorization': `Bearer ${token}` } : {}
	}

	async function connectTwitch() {
		if (connecting) return
		connecting = true
		try {
			const res = await fetch('/api/v1/streamer/twitch/auth-init', { headers: authHeaders() })
			if (!res.ok) {
				pushToast('Impossible de démarrer OAuth (HTTP ' + res.status + ')', false)
				connecting = false
				return
			}
			const { authorizeUrl } = await res.json()
			window.location.href = authorizeUrl
		} catch {
			pushToast('Erreur réseau', false)
			connecting = false
		}
	}

	async function refreshTokens() {
		if (!primary || refreshing) return
		refreshing = true
		try {
			const res = await fetch(`/api/v1/streamer/twitch/refresh/${primary.id}`, {
				method:  'POST',
				headers: authHeaders(),
			})
			if (res.ok) {
				pushToast('Tokens rafraîchis', true)
				await invalidateAll()
			} else {
				const err = await res.json().catch(() => ({}))
				pushToast(err.message ?? 'Refresh échoué', false)
			}
		} catch {
			pushToast('Erreur réseau', false)
		} finally {
			refreshing = false
		}
	}

	async function syncSubscriptions() {
		if (!primary || syncing) return
		syncing = true
		try {
			const res = await fetch('/api/v1/streamer/twitch/sync-subscriptions', {
				method:  'POST',
				headers: authHeaders(),
			})
			if (res.ok) {
				const j = await res.json()
				pushToast(`Sync : ${j.created} créées, ${j.skipped} déjà OK, ${j.failed} en échec`, j.failed === 0)
				await invalidateAll()
			} else {
				const err = await res.json().catch(() => ({}))
				pushToast(err.message ?? 'Sync échoué', false)
			}
		} catch {
			pushToast('Erreur réseau', false)
		} finally {
			syncing = false
		}
	}

	async function disconnect() {
		if (!primary || disconnecting) return
		if (!confirm(`Déconnecter ${primary.externalLogin} ?\n\nLes tokens chiffrés seront supprimés et les subscriptions EventSub côté Twitch deviendront orphelines. Une reconnexion future les recréera.`)) return
		disconnecting = true
		try {
			const res = await fetch(`/api/v1/streamer/twitch/${primary.id}`, {
				method:  'DELETE',
				headers: authHeaders(),
			})
			if (res.ok) {
				pushToast('Streamer déconnecté', true)
				await invalidateAll()
			} else {
				pushToast('Déconnexion échouée', false)
			}
		} catch {
			pushToast('Erreur réseau', false)
		} finally {
			disconnecting = false
		}
	}

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleString('fr-FR', {
			day: '2-digit', month: 'short', year: 'numeric',
			hour: '2-digit', minute: '2-digit',
		})
	}

	function fmtRelative(iso: string): string {
		const ms = Date.now() - new Date(iso).getTime()
		const s  = Math.floor(Math.abs(ms) / 1000)
		const future = ms < 0
		const v =
			s < 60    ? `${s}s` :
			s < 3600  ? `${Math.floor(s/60)}min` :
			s < 86400 ? `${Math.floor(s/3600)}h` :
			            `${Math.floor(s/86400)}j`
		return future ? `dans ${v}` : `il y a ${v}`
	}

	function shortId(id: string | null): string {
		return id ? id.slice(0, 8) + '…' : ''
	}

	// Map status -> health bucket + visible label
	const SUBS_STATUS: Record<Subscription['status'], { ring: string; label: string }> = {
		enabled: { ring: 'bg-emerald-500',   label: 'OK'      },
		pending: { ring: 'bg-amber-400',     label: 'En attente' },
		failed:  { ring: 'bg-rose-500',      label: 'Échec'   },
		revoked: { ring: 'bg-rose-500',      label: 'Révoqué' },
	}

	const EVENT_META: Record<string, { label: string; tone: string; desc: string }> = {
		'channel.follow':            { label: 'Follow',         tone: 'cyan',    desc: 'Nouveau follower' },
		'channel.subscribe':         { label: 'Sub',            tone: 'purple',  desc: 'Abonnement direct' },
		'channel.subscription.gift': { label: 'Sub offert',     tone: 'pink',    desc: 'Sub offert à un viewer' },
		'channel.cheer':             { label: 'Bits',           tone: 'amber',   desc: 'Don de bits' },
		'channel.raid':              { label: 'Raid',           tone: 'red',     desc: 'Raid entrant' },
		'channel.poll.begin':        { label: 'Poll lancé',     tone: 'indigo',  desc: 'Sondage démarré' },
		'channel.poll.end':          { label: 'Poll terminé',   tone: 'indigo',  desc: 'Sondage clôturé' },
		'channel.chat.message':      { label: 'Message',        tone: 'slate',   desc: 'Message Twitch chat' },
		'stream.online':             { label: 'Live ON',        tone: 'emerald', desc: 'Diffusion en direct' },
		'stream.offline':            { label: 'Live OFF',       tone: 'slate',   desc: 'Diffusion terminée' },
	}

	// Render a human-readable summary from the raw EventSub payload, instead of
	// dumping JSON. Falls back to the event type if the shape is unexpected.
	function humanize(evt: RecentEvent): string {
		const e = evt.payload?.event ?? {}
		switch (evt.eventType) {
			case 'channel.follow':
				return `${e.user_name ?? e.user_login ?? '?'} a follow`
			case 'channel.subscribe': {
				const tier = String(e.tier ?? '').replace('000', '')
				return `${e.user_name ?? '?'} s'abonne (tier ${tier || '1'}${e.is_gift ? ' • offert' : ''})`
			}
			case 'channel.subscription.gift':
				return `${e.user_name ?? 'Anonyme'} offre ${e.total ?? 1} sub(s)`
			case 'channel.cheer':
				return `${e.is_anonymous ? 'Anonyme' : e.user_name ?? '?'} a cheer ${e.bits ?? '?'} bits`
			case 'channel.raid':
				return `Raid de ${e.from_broadcaster_user_name ?? '?'} avec ${e.viewers ?? '?'} viewers`
			case 'channel.poll.begin':
				return `Poll lancé : « ${e.title ?? '?'} » (${Array.isArray(e.choices) ? e.choices.length : '?'} choix)`
			case 'channel.poll.end':
				return `Poll terminé : « ${e.title ?? '?'} »`
			case 'channel.chat.message':
				return `${e.chatter_user_name ?? '?'} : ${typeof e.message === 'object' && e.message && 'text' in e.message ? String((e.message as { text: string }).text).slice(0, 80) : ''}`
			case 'stream.online':
				return `Stream live (${e.type ?? 'live'})`
			case 'stream.offline':
				return 'Stream terminé'
			default:
				return evt.eventType
		}
	}

	// Last seen timestamp per eventType, computed from recent events.
	const lastSeenByType = $derived((() => {
		const map = new Map<string, string>()
		for (const e of events) {
			if (!map.has(e.eventType)) map.set(e.eventType, e.occurredAt)
		}
		return map
	})())

	const TONE_CLASSES: Record<string, string> = {
		cyan:    'bg-cyan-500/15    text-cyan-300    border-cyan-500/30',
		purple:  'bg-purple-500/15  text-purple-300  border-purple-500/30',
		pink:    'bg-pink-500/15    text-pink-300    border-pink-500/30',
		amber:   'bg-amber-500/15   text-amber-300   border-amber-500/30',
		red:     'bg-rose-500/15    text-rose-300    border-rose-500/30',
		indigo:  'bg-indigo-500/15  text-indigo-300  border-indigo-500/30',
		emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
		slate:   'bg-slate-500/15   text-slate-300   border-slate-500/30',
	}
</script>

<svelte:head>
	<title>Streamer Hub : Administration</title>
</svelte:head>

<div class="max-w-6xl mx-auto space-y-6">

	<!-- ── Header ──────────────────────────────────────────────────────────── -->
	<header class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-white flex items-center gap-3">
				<svg class="w-7 h-7 text-cyan-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
				Streamer Hub
			</h1>
			<p class="text-sm text-slate-400 mt-1.5 max-w-2xl">
				Bridge Twitch natif. OAuth chiffré AES-256-GCM, EventSub avec HMAC, chat unifié bidirectionnel. Sans dépendre de Streamlabs ni StreamElements.
			</p>
		</div>
		<div class="flex items-center gap-2 px-3 py-1.5 rounded-full border {isConnected ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-slate-600/40 bg-slate-700/20'}">
			<span class="w-2 h-2 rounded-full {isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}"></span>
			<span class="text-xs font-medium uppercase tracking-wider {isConnected ? 'text-emerald-300' : 'text-slate-400'}">
				{isConnected ? 'Connecté' : 'Déconnecté'}
			</span>
		</div>
	</header>

	<!-- ── Health overview ─────────────────────────────────────────────────── -->
	{#if isConnected && primary}
		<section class="grid grid-cols-2 md:grid-cols-4 gap-3">
			<!-- Connexion -->
			<div class="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] uppercase tracking-widest text-emerald-400/80 font-semibold">Connexion</span>
					<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
				</div>
				<div class="text-base font-semibold text-white truncate" title={primary.externalLogin}>{primary.externalLogin}</div>
				<div class="text-[11px] text-slate-500 mt-0.5 font-mono">twitch_id={primary.externalId}</div>
			</div>

			<!-- EventSub -->
			<div class="rounded-xl border {subsHealth === 'ok' ? 'border-emerald-500/25 bg-emerald-500/5' : subsHealth === 'warning' ? 'border-amber-500/25 bg-amber-500/5' : 'border-rose-500/25 bg-rose-500/5'} p-4">
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] uppercase tracking-widest font-semibold {subsHealth === 'ok' ? 'text-emerald-400/80' : subsHealth === 'warning' ? 'text-amber-400/80' : 'text-rose-400/80'}">EventSub</span>
					<span class="w-1.5 h-1.5 rounded-full {subsHealth === 'ok' ? 'bg-emerald-400' : subsHealth === 'warning' ? 'bg-amber-400' : 'bg-rose-400'}"></span>
				</div>
				<div class="text-base font-semibold text-white">{enabledCount}<span class="text-slate-500 text-sm font-normal"> / {subs.length}</span></div>
				<div class="text-[11px] text-slate-500 mt-0.5">
					{failedCount > 0 ? `${failedCount} en échec` : pendingCount > 0 ? `${pendingCount} en attente` : 'Toutes actives'}
				</div>
			</div>

			<!-- Tokens -->
			<div class="rounded-xl border {tokenHealth === 'ok' ? 'border-emerald-500/25 bg-emerald-500/5' : tokenHealth === 'warning' ? 'border-amber-500/25 bg-amber-500/5' : 'border-rose-500/25 bg-rose-500/5'} p-4" title="Refresh auto programmé 30 min avant expiration. Tu peux aussi forcer un refresh manuel.">
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] uppercase tracking-widest font-semibold {tokenHealth === 'ok' ? 'text-emerald-400/80' : tokenHealth === 'warning' ? 'text-amber-400/80' : 'text-rose-400/80'}">Access token</span>
					<span class="w-1.5 h-1.5 rounded-full {tokenHealth === 'ok' ? 'bg-emerald-400' : tokenHealth === 'warning' ? 'bg-amber-400' : 'bg-rose-400'}"></span>
				</div>
				<div class="text-base font-semibold text-white">
					{tokenExpiresInMs < 0 ? 'Expiré' : 'Expire ' + fmtRelative(primary.expiresAt)}
				</div>
				<div class="text-[11px] text-slate-500 mt-0.5">Dernière rotation {fmtRelative(primary.rotatedAt)}</div>
			</div>

			<!-- Activité -->
			<div class="rounded-xl border {activityHealth === 'ok' ? 'border-emerald-500/25 bg-emerald-500/5' : activityHealth === 'warning' ? 'border-amber-500/25 bg-amber-500/5' : 'border-slate-600/30 bg-slate-700/10'} p-4" title="Heure du dernier événement reçu via EventSub. Si > 6h, vérifie que tes subscriptions sont enabled.">
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] uppercase tracking-widest font-semibold {activityHealth === 'ok' ? 'text-emerald-400/80' : activityHealth === 'warning' ? 'text-amber-400/80' : 'text-slate-400/80'}">Activité</span>
					<span class="w-1.5 h-1.5 rounded-full {activityHealth === 'ok' ? 'bg-emerald-400' : activityHealth === 'warning' ? 'bg-amber-400' : 'bg-slate-500'}"></span>
				</div>
				<div class="text-base font-semibold text-white">
					{lastEvent ? EVENT_META[lastEvent.eventType]?.label ?? lastEvent.eventType : 'Aucun event'}
				</div>
				<div class="text-[11px] text-slate-500 mt-0.5">
					{lastEvent ? fmtRelative(lastEvent.occurredAt) : 'Lance un live ou demande un follow'}
				</div>
			</div>
		</section>
	{/if}

	<!-- ── Connection card (when disconnected) ─────────────────────────────── -->
	{#if !isConnected}
		<section class="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/40 via-slate-900 to-indigo-950/40 p-6 space-y-5">
			<div class="flex items-start gap-4">
				<div class="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0">
					<svg class="w-6 h-6 text-cyan-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
				</div>
				<div class="flex-1">
					<h2 class="text-lg font-semibold text-white">Connecter ton compte Twitch</h2>
					<p class="text-sm text-slate-400 mt-1.5">
						Tu seras redirigé vers Twitch pour autoriser Nodyx. Au retour, on souscrit automatiquement aux 9 événements EventSub Phase 1 + 2 et on chiffre les tokens AES-256-GCM avant écriture en base.
					</p>
				</div>
			</div>

			<div class="rounded-lg border border-slate-700/60 bg-slate-900/50 p-4 space-y-3">
				<div class="text-xs font-semibold uppercase tracking-wider text-slate-300">Ce qui sera demandé à Twitch</div>
				<div class="flex flex-wrap gap-1.5">
					{#each ['user:read:email', 'channel:read:subscriptions', 'bits:read', 'moderator:read:followers', 'user:read:chat', 'user:write:chat', 'channel:read:polls'] as scope}
						<code class="text-[10px] font-mono bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded border border-slate-700/60">{scope}</code>
					{/each}
				</div>
				<div class="text-[11px] text-slate-500 leading-relaxed">
					Aucun de ces scopes ne donne accès à ta clé de streaming, à tes paramètres Twitch ou à ton historique de paiement. Seuls les events temps réel et l'envoi de messages dans ton propre chat sont permis.
				</div>
			</div>

			<div class="flex flex-col sm:flex-row sm:justify-end gap-3">
				<button type="button" onclick={() => helpOpen = !helpOpen}
					class="text-sm text-slate-300 hover:text-white px-4 py-2.5 rounded-lg border border-slate-700 hover:border-slate-500 transition-colors inline-flex items-center gap-2">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
					Prérequis et FAQ
				</button>
				<button type="button" onclick={connectTwitch} disabled={connecting}
					class="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold px-5 py-2.5 rounded-lg transition-colors inline-flex items-center gap-2 shadow-lg shadow-cyan-500/30">
					{#if connecting}
						<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M20 4a16 16 0 00-16 16"/></svg>
						Redirection…
					{:else}
						Connecter Twitch
						<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
					{/if}
				</button>
			</div>
		</section>
	{:else if primary}
		<!-- ── Streamer details ───────────────────────────────────────────── -->
		<section class="rounded-xl border border-slate-700/60 bg-slate-900/50 p-5">
			<div class="flex items-start gap-4">
				<div class="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0">
					<svg class="w-6 h-6 text-cyan-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
				</div>
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2 flex-wrap">
						<h2 class="text-lg font-semibold text-white">{primary.externalLogin}</h2>
						<span class="text-[10px] font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded">twitch_id={primary.externalId}</span>
					</div>
					<div class="text-xs text-slate-500 mt-1">
						Token expire {fmtDate(primary.expiresAt)} · Refresh auto programmé 30 min avant
					</div>
					<div class="mt-3 flex flex-wrap gap-1.5">
						{#each primary.scopes as scope}
							<code class="text-[10px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700/60">{scope}</code>
						{/each}
					</div>
				</div>
				<div class="flex flex-col gap-2 shrink-0">
					<button type="button" onclick={syncSubscriptions} disabled={syncing}
						title="Recrée les subscriptions EventSub côté Twitch. Utile après l'ajout de nouveaux types d'events sans avoir à reconnecter."
						class="text-xs bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-50 text-cyan-300 border border-cyan-500/30 px-3 py-1.5 rounded-lg transition-colors">
						{syncing ? 'Sync…' : 'Synchroniser EventSub'}
					</button>
					<button type="button" onclick={refreshTokens} disabled={refreshing}
						title="Force le refresh du access token Twitch via le refresh token. Sans effet si tokens encore frais."
						class="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 px-3 py-1.5 rounded-lg transition-colors">
						{refreshing ? 'Refresh…' : 'Refresh tokens'}
					</button>
					<button type="button" onclick={disconnect} disabled={disconnecting}
						title="Supprime les tokens chiffrés et révoque la subscription EventSub côté Twitch."
						class="text-xs bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-300 border border-rose-500/30 px-3 py-1.5 rounded-lg transition-colors">
						{disconnecting ? 'Déconnexion…' : 'Déconnecter'}
					</button>
				</div>
			</div>
		</section>

		<!-- ── EventSub subscriptions ─────────────────────────────────────── -->
		<section class="rounded-xl border border-slate-700/60 bg-slate-900/50 overflow-hidden">
			<header class="px-5 py-3 border-b border-slate-700/60 flex items-center justify-between">
				<div>
					<h2 class="text-sm font-semibold text-white">Subscriptions EventSub</h2>
					<p class="text-[11px] text-slate-500 mt-0.5">Chaque ligne représente un webhook actif côté Twitch. Si une ligne est en échec, clique "Synchroniser" pour la recréer.</p>
				</div>
				<div class="flex items-center gap-3 text-xs">
					<span class="text-emerald-300"><span class="text-emerald-400">●</span> {enabledCount} OK</span>
					{#if pendingCount > 0}<span class="text-amber-300"><span class="text-amber-400">●</span> {pendingCount} attente</span>{/if}
					{#if failedCount > 0}<span class="text-rose-300"><span class="text-rose-400">●</span> {failedCount} échec</span>{/if}
				</div>
			</header>
			<ul class="divide-y divide-slate-700/40">
				{#each subs as sub}
					{@const meta = EVENT_META[sub.eventType] ?? { label: sub.eventType, tone: 'slate', desc: '' }}
					{@const last = lastSeenByType.get(sub.eventType)}
					<li class="px-5 py-3 flex items-center gap-4 hover:bg-slate-800/20 transition-colors">
						<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border {TONE_CLASSES[meta.tone]} shrink-0 min-w-20 justify-center">{meta.label}</span>
						<div class="flex-1 min-w-0">
							<div class="text-sm text-slate-200 font-mono truncate" title={meta.desc}>{sub.eventType}</div>
							<div class="text-[11px] text-slate-500 mt-0.5">{meta.desc} · sub_id {shortId(sub.externalSubId)}</div>
						</div>
						<div class="text-[11px] text-slate-500 text-right hidden sm:block">
							{#if last}
								Dernier event<br/><span class="text-slate-300">{fmtRelative(last)}</span>
							{:else}
								<span class="text-slate-600">aucun event reçu</span>
							{/if}
						</div>
						<span class="inline-flex items-center gap-1.5 shrink-0">
							<span class="w-1.5 h-1.5 rounded-full {SUBS_STATUS[sub.status].ring}"></span>
							<span class="text-[10px] font-medium uppercase tracking-wider text-slate-400">{SUBS_STATUS[sub.status].label}</span>
						</span>
					</li>
				{:else}
					<li class="px-5 py-10 text-center text-sm text-slate-500">
						Aucune subscription créée. Rafraîchis la page après le callback OAuth, ou clique "Synchroniser EventSub".
					</li>
				{/each}
			</ul>
		</section>

		<!-- ── Recent events feed ─────────────────────────────────────────── -->
		<section class="rounded-xl border border-slate-700/60 bg-slate-900/50 overflow-hidden">
			<header class="px-5 py-3 border-b border-slate-700/60">
				<h2 class="text-sm font-semibold text-white">Événements récents</h2>
				<p class="text-[11px] text-slate-500 mt-0.5">{events.length} dans le feed. Chaque event est persisté + diffusé dans <code class="font-mono text-cyan-300">#twitch-chat</code> et dispatché aux subscribers du chat bridge.</p>
			</header>
			<ul class="divide-y divide-slate-700/40">
				{#each events as evt}
					{@const meta = EVENT_META[evt.eventType] ?? { label: evt.eventType, tone: 'slate', desc: '' }}
					<li class="px-5 py-2.5 flex items-center gap-3 text-sm hover:bg-slate-800/20 transition-colors">
						<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border {TONE_CLASSES[meta.tone]} shrink-0 min-w-20 justify-center">{meta.label}</span>
						<span class="flex-1 text-slate-200 truncate" title={humanize(evt)}>{humanize(evt)}</span>
						<span class="shrink-0 text-[11px] text-slate-500 tabular-nums">{fmtRelative(evt.occurredAt)}</span>
					</li>
				{:else}
					<li class="px-5 py-10 text-center text-sm text-slate-500">
						Aucun événement reçu. Lance un stream ou demande à un viewer de te follow pour vérifier le pipeline end-to-end.
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- ── Help & FAQ ──────────────────────────────────────────────────────── -->
	<section class="rounded-xl border border-slate-700/60 bg-slate-900/40 overflow-hidden">
		<button type="button" onclick={() => helpOpen = !helpOpen}
			class="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors">
			<div class="flex items-center gap-3">
				<svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
				<span class="text-sm font-semibold text-slate-200">Prérequis, dépannage et FAQ</span>
			</div>
			<svg class="w-4 h-4 text-slate-400 transition-transform {helpOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
		</button>
		{#if helpOpen}
			<div class="px-5 pb-5 space-y-5 text-sm text-slate-300 border-t border-slate-700/60 pt-4">
				<div>
					<div class="text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-2">Avant de connecter</div>
					<ul class="space-y-2 text-slate-400 leading-relaxed">
						<li><strong class="text-slate-200">TWITCH_CLIENT_ID</strong> et <strong class="text-slate-200">TWITCH_CLIENT_SECRET</strong> doivent être définis dans <code class="font-mono text-cyan-300">nodyx-core/.env</code>. Crée l'app sur <code class="font-mono">dev.twitch.tv/console</code> avec comme redirect URI <code class="font-mono text-cyan-300">https://&lt;ton-domaine&gt;/api/v1/streamer/twitch/callback</code>.</li>
						<li><strong class="text-slate-200">STREAMER_OAUTH_KEY</strong> (32 octets hex) protège les tokens en base via AES-256-GCM + HKDF. <code class="font-mono text-slate-500">node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"</code></li>
						<li><strong class="text-slate-200">PUBLIC_BASE_URL</strong> doit pointer vers ton domaine public en HTTPS, c'est l'URL qui sera utilisée pour les webhooks EventSub (Twitch ne livre que sur HTTPS).</li>
					</ul>
				</div>
				<div>
					<div class="text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-2">Quand utiliser quelle action</div>
					<ul class="space-y-2 text-slate-400 leading-relaxed">
						<li><strong class="text-slate-200">Synchroniser EventSub</strong> : après une mise à jour de Nodyx qui ajoute de nouveaux types d'events, ou si une subscription apparaît en échec.</li>
						<li><strong class="text-slate-200">Refresh tokens</strong> : seulement utile en débogage. Le refresh automatique tourne 30 min avant l'expiration.</li>
						<li><strong class="text-slate-200">Déconnecter</strong> : supprime les tokens chiffrés. Les subscriptions EventSub deviennent orphelines côté Twitch et seront recréées à la prochaine connexion.</li>
					</ul>
				</div>
				<div>
					<div class="text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-2">Dépannage rapide</div>
					<ul class="space-y-2 text-slate-400 leading-relaxed">
						<li><strong class="text-slate-200">"Pipeline failure" au callback</strong> : vérifie <code class="font-mono text-cyan-300">TWITCH_CLIENT_SECRET</code>, l'URL de redirect Twitch (exact match), et que <code class="font-mono">PUBLIC_BASE_URL</code> est en HTTPS.</li>
						<li><strong class="text-slate-200">Subscription en échec</strong> : Twitch a renvoyé <code class="font-mono">webhook_callback_verification_failed</code>. Souvent un certificat HTTPS expiré ou un proxy qui bloque le POST avec body brut. Reset la sub via "Synchroniser".</li>
						<li><strong class="text-slate-200">Aucun event après 30 min</strong> : le HMAC est probablement invalide. Vérifie les logs <code class="font-mono text-cyan-300">pm2 logs nodyx-core | grep EventSub</code>.</li>
					</ul>
				</div>
				<div class="flex flex-wrap gap-3 pt-2 border-t border-slate-700/40">
					<a href="https://nodyx.dev/admin/streamer-hub" class="text-xs text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1">
						Documentation complète
						<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
					</a>
					<a href="https://dev.twitch.tv/docs/eventsub/" class="text-xs text-slate-400 hover:text-slate-300 inline-flex items-center gap-1">
						EventSub Reference Twitch
						<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
					</a>
				</div>
			</div>
		{/if}
	</section>

	{#if toast}
		<div class="fixed bottom-6 right-6 max-w-sm px-4 py-3 rounded-lg shadow-lg text-sm
		            {toast.ok ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-100'
		                      : 'bg-rose-500/15 border border-rose-500/40 text-rose-100'}">
			{toast.text}
		</div>
	{/if}
</div>
