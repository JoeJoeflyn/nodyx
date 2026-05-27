<script lang="ts">
	import { onMount } from 'svelte'
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'

	// Audience tab : liste des membres Nodyx qui ont link leur compte Twitch
	// via Flow A. C'est l'écran qui justifie Nodyx comme cross-platform :
	// croisement identité Nodyx ↔ identité Twitch + stats agrégées.

	interface Props {
		token: string
	}

	let { token }: Props = $props()

	type Viewer = {
		userId:         string
		username:       string
		avatarUrl:      string | null
		twitchId:       string
		twitchLogin:    string
		messageCount:   number
		eventCount:     number
		lastActivityAt: string | null
		linkedAt:       string
	}

	let viewers = $state<Viewer[]>([])
	let loading = $state(true)
	let toast   = $state<{ text: string; ok: boolean } | null>(null)
	let search  = $state('')
	let sortBy  = $state<'activity' | 'messages' | 'events' | 'linked'>('activity')

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3500)
	}

	async function reload(): Promise<void> {
		try {
			const res = await apiFetch(fetch, '/streamer/twitch/linked-viewers?limit=500', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json() as { viewers: Viewer[] }
				viewers = data.viewers ?? []
			} else {
				flash('Échec du fetch des linked viewers.', false)
			}
		} catch {
			flash('Erreur réseau.', false)
		} finally {
			loading = false
		}
	}

	onMount(() => { reload() })

	async function unlink(v: Viewer): Promise<void> {
		if (!confirm(`Délier le compte Twitch de "${v.username}" (twitch: ${v.twitchLogin}) ?\n\nLe membre Nodyx peut re-link à tout moment via Flow A.`)) return
		try {
			const res = await apiFetch(fetch, `/streamer/twitch/linked-viewers/${v.userId}`, {
				method:  'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) { flash(`${v.username} délié.`, true); await reload() }
			else        flash('Délier échoué.', false)
		} catch {
			flash('Erreur réseau.', false)
		}
	}

	const filteredViewers = $derived.by<Viewer[]>(() => {
		const q = search.trim().toLowerCase()
		const base = q
			? viewers.filter(v =>
				v.username.toLowerCase().includes(q) ||
				v.twitchLogin.toLowerCase().includes(q),
			)
			: viewers
		const sorted = [...base]
		switch (sortBy) {
			case 'messages':
				sorted.sort((a, b) => b.messageCount - a.messageCount)
				break
			case 'events':
				sorted.sort((a, b) => b.eventCount - a.eventCount)
				break
			case 'linked':
				sorted.sort((a, b) => new Date(b.linkedAt).getTime() - new Date(a.linkedAt).getTime())
				break
			case 'activity':
			default:
				sorted.sort((a, b) => {
					const ta = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0
					const tb = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0
					return tb - ta
				})
		}
		return sorted
	})

	function fmtRelative(iso: string | null): string {
		if (!iso) return 'jamais'
		const diff = Date.now() - new Date(iso).getTime()
		const m = Math.floor(diff / 60_000)
		if (m < 1)    return 'à l\'instant'
		if (m < 60)   return `il y a ${m} min`
		const h = Math.floor(m / 60)
		if (h < 24)   return `il y a ${h}h`
		const d = Math.floor(h / 24)
		if (d < 30)   return `il y a ${d}j`
		const mo = Math.floor(d / 30)
		return `il y a ${mo} mois`
	}
</script>

<section class="rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-950/30 via-slate-900/60 to-indigo-950/20 p-5 space-y-4">
	<header class="flex items-center justify-between gap-3 flex-wrap">
		<div class="flex items-center gap-2.5">
			<svg class="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
			<h2 class="text-sm font-semibold text-white">Viewers Twitch liés à Nodyx</h2>
			<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">{viewers.length}</span>
		</div>
		<span class="text-[11px] text-slate-500">Membres Nodyx qui ont link leur Twitch via Flow A</span>
	</header>

	{#if toast}
		<div class="rounded-lg border p-3 text-xs flex items-center gap-2 {toast.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}">
			<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
			{toast.text}
		</div>
	{/if}

	<!-- Search + sort -->
	<div class="flex gap-2 flex-wrap">
		<div class="flex-1 min-w-48 relative">
			<svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
			<input type="text" bind:value={search} placeholder="Chercher par username Nodyx ou login Twitch…"
				class="w-full rounded-lg bg-slate-950/60 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 pl-9 pr-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors"/>
		</div>
		<select bind:value={sortBy}
			class="rounded-lg bg-slate-950/60 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-3 py-2 text-sm text-white outline-none transition-colors">
			<option value="activity">Dernière activité</option>
			<option value="messages">Plus de messages</option>
			<option value="events">Plus d'events</option>
			<option value="linked">Liaison récente</option>
		</select>
	</div>

	<!-- List -->
	{#if loading}
		<div class="text-xs text-slate-500 text-center py-8">Chargement…</div>
	{:else if filteredViewers.length === 0}
		<div class="rounded-lg border border-dashed border-slate-700/60 bg-slate-900/30 p-8 text-center text-xs text-slate-500 space-y-2">
			{#if search.trim()}
				<div>Aucun résultat pour "{search}".</div>
			{:else}
				<div class="text-sm text-slate-400">Aucun viewer Twitch lié pour l'instant.</div>
				<p class="leading-relaxed max-w-md mx-auto">
					Pour qu'un membre Nodyx link son compte Twitch, il doit passer par <strong class="text-slate-300">Flow A</strong> : page de son profil → bouton "Lier mon Twitch" → OAuth. Ils gagnent le droit d'apparaitre comme eux-mêmes dans le chat #twitch-chat (au lieu d'un ghost <code class="font-mono text-[10px] bg-slate-800 px-1 rounded">tw_&lt;login&gt;</code>).
				</p>
			{/if}
		</div>
	{:else}
		<ul class="space-y-2">
			{#each filteredViewers as v (v.userId)}
				<li class="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 flex items-center gap-3 hover:border-slate-600/80 transition-colors">
					{#if v.avatarUrl}
						<img src={v.avatarUrl} alt="" class="w-12 h-12 rounded-full object-cover shrink-0 border border-slate-700/60" loading="lazy"/>
					{:else}
						<div class="w-12 h-12 rounded-full shrink-0 bg-gradient-to-br from-indigo-500 to-purple-700 flex items-center justify-center text-white font-bold text-lg">
							{v.username.charAt(0).toUpperCase()}
						</div>
					{/if}

					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 flex-wrap">
							<a href="/users/{v.username}" class="text-sm font-semibold text-white hover:text-cyan-300 transition-colors truncate" title={v.username}>{v.username}</a>
							<span class="text-[10px] font-mono text-slate-500">↔</span>
							<a href="https://twitch.tv/{v.twitchLogin}" target="_blank" rel="noopener noreferrer"
								class="text-[11px] font-mono text-purple-400 hover:text-purple-300 transition-colors inline-flex items-center gap-1">
								<svg class="w-3 h-3" viewBox="0 0 24 28" fill="currentColor"><path d="M5 0L0 5v18h6v5l5-5h4l9-9V0H5zm17 13l-4 4h-6l-4 4v-4H4V3h18v10zM18 6h-2v6h2V6zm-5 0h-2v6h2V6z"/></svg>
								{v.twitchLogin}
							</a>
						</div>
						<div class="text-[10px] text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
							<span><strong class="text-slate-300">{v.messageCount.toLocaleString('fr-FR')}</strong> message{v.messageCount > 1 ? 's' : ''}</span>
							<span><strong class="text-slate-300">{v.eventCount.toLocaleString('fr-FR')}</strong> event{v.eventCount > 1 ? 's' : ''}</span>
							<span>Dernière activité : <span class={v.lastActivityAt ? 'text-emerald-400' : 'text-slate-600'}>{fmtRelative(v.lastActivityAt)}</span></span>
							<span class="text-slate-600">Lié {fmtRelative(v.linkedAt)}</span>
						</div>
					</div>

					<button type="button" onclick={() => unlink(v)}
						class="shrink-0 text-[10px] text-rose-300 hover:text-rose-200 border border-rose-500/30 hover:border-rose-500/50 px-2.5 py-1.5 rounded transition-colors">
						Délier
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
