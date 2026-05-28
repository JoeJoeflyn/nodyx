<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { onMount } from 'svelte'
	import Tooltip from '$lib/components/ui/Tooltip.svelte'

	// Bot Chat — chat timers : messages bot récurrents postés dans le chat Twitch.
	// Variables supportées dans le template : {nodyx_url}, {streamer}, {uptime}.

	interface Props {
		token: string
	}

	let { token }: Props = $props()

	type TriggerMode = 'recurring' | 'once_per_live' | 'once'

	interface ChatTimer {
		id:               string
		label:            string
		enabled:          boolean
		messageTemplate:  string
		intervalMinutes:  number
		minChatMessages:  number
		liveOnly:         boolean
		triggerMode:      TriggerMode
		lastSentAt:       string | null
		createdAt:        string
		updatedAt:        string
	}

	const MODE_LABELS: Record<TriggerMode, string> = {
		recurring:      'Récurrent',
		once_per_live:  'Une fois par live',
		once:           'Une seule fois',
	}

	const MODE_DESCS: Record<TriggerMode, string> = {
		recurring:      'Tourne en boucle à l\'intervalle défini',
		once_per_live:  'Envoyé une fois par session, après un délai d\'accueil. Idéal pour les bienvenues.',
		once:           'Envoyé une seule fois, puis se désactive automatiquement',
	}

	let timers   = $state<ChatTimer[]>([])
	let loading  = $state(true)
	let toast    = $state<{ text: string; ok: boolean } | null>(null)

	// Form state (création + édition inline du timer en cours d'édition)
	let editingId        = $state<string | null>(null)
	let formLabel        = $state('')
	let formTemplate     = $state('')
	let formInterval     = $state(15)
	let formMinMsgs      = $state(5)
	let formLiveOnly     = $state(true)
	let formEnabled      = $state(true)
	let formMode         = $state<TriggerMode>('recurring')
	let formPreview      = $state<string | null>(null)
	let formBusy         = $state(false)
	let sendingNowId     = $state<string | null>(null)
	let templateInputEl  = $state<HTMLTextAreaElement | null>(null)

	const INSERTABLE_VARS = [
		{ token: '{nodyx_url}', label: 'Lien Nodyx',  desc: 'URL de l\'instance' },
		{ token: '{streamer}',  label: 'Streamer',    desc: 'Nom de la chaine Twitch' },
		{ token: '{uptime}',    label: 'Uptime',      desc: 'Durée du stream en cours' },
	]

	// ── Presets : "recettes" pré-faites pour démarrer vite ────────────────
	interface TimerPreset {
		key:        string
		label:      string
		emoji:      string
		hint:       string
		fill: () => void
	}

	const PRESETS: TimerPreset[] = [
		{
			key:   'welcome',
			label: 'Bienvenue',
			emoji: '👋',
			hint:  'Phrase d\'accueil au début de chaque stream',
			fill: () => {
				formLabel    = 'Bienvenue'
				formTemplate = 'Salut à tous, bienvenue sur le stream ! Tape !nodyx pour rejoindre la commu : {nodyx_url}'
				formMode     = 'once_per_live'
				formInterval = 2
				formMinMsgs  = 0
				formLiveOnly = true
				formEnabled  = true
			},
		},
		{
			key:   'pub_nodyx',
			label: 'Pub Nodyx',
			emoji: '🚀',
			hint:  'Rappel récurrent pour ramener les viewers sur ta commu',
			fill: () => {
				formLabel    = 'Pub Nodyx'
				formTemplate = 'Rejoins la communauté sur Nodyx : {nodyx_url} (tape !nodyx pour le lien direct)'
				formMode     = 'recurring'
				formInterval = 15
				formMinMsgs  = 5
				formLiveOnly = true
				formEnabled  = true
			},
		},
		{
			key:   'schedule',
			label: 'Schedule',
			emoji: '📅',
			hint:  'Rappel récurrent de tes horaires de stream',
			fill: () => {
				formLabel    = 'Schedule'
				formTemplate = 'Stream tous les soirs à 21h. Pense à follow pour ne rien rater !'
				formMode     = 'recurring'
				formInterval = 30
				formMinMsgs  = 3
				formLiveOnly = true
				formEnabled  = true
			},
		},
		{
			key:   'social',
			label: 'Réseaux',
			emoji: '🔗',
			hint:  'Tes autres réseaux sociaux à intervalle régulier',
			fill: () => {
				formLabel    = 'Mes réseaux'
				formTemplate = 'Retrouve-moi sur Nodyx ({nodyx_url}) et sur mes autres réseaux !'
				formMode     = 'recurring'
				formInterval = 20
				formMinMsgs  = 5
				formLiveOnly = true
				formEnabled  = true
			},
		},
		{
			key:   'announce_once',
			label: 'Annonce',
			emoji: '📣',
			hint:  'Annonce ponctuelle (envoyée une seule fois)',
			fill: () => {
				formLabel    = 'Annonce'
				formTemplate = 'Annonce importante : événement spécial ce soir ! Plus d\'infos sur {nodyx_url}'
				formMode     = 'once'
				formInterval = 5
				formMinMsgs  = 0
				formLiveOnly = true
				formEnabled  = true
			},
		},
	]

	function applyPreset(p: TimerPreset): void {
		editingId = null  // toujours créer une nouvelle row depuis un preset
		p.fill()
		flash(`Preset "${p.label}" chargé. Personnalise puis enregistre.`, true)
	}

	function insertVar(token: string): void {
		const el = templateInputEl
		if (!el) {
			formTemplate = formTemplate + (formTemplate.endsWith(' ') || !formTemplate ? '' : ' ') + token
			return
		}
		const start = el.selectionStart ?? formTemplate.length
		const end   = el.selectionEnd   ?? formTemplate.length
		formTemplate = formTemplate.slice(0, start) + token + formTemplate.slice(end)
		// Replace caret après la variable insérée
		setTimeout(() => {
			el.focus()
			const pos = start + token.length
			el.setSelectionRange(pos, pos)
		}, 0)
	}

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3500)
	}

	function resetForm(): void {
		editingId    = null
		formLabel    = ''
		formTemplate = ''
		formInterval = 15
		formMinMsgs  = 5
		formLiveOnly = true
		formEnabled  = true
		formMode     = 'recurring'
		formPreview  = null
	}

	function loadTemplate(t: ChatTimer): void {
		editingId    = t.id
		formLabel    = t.label
		formTemplate = t.messageTemplate
		formInterval = t.intervalMinutes
		formMinMsgs  = t.minChatMessages
		formLiveOnly = t.liveOnly
		formEnabled  = t.enabled
		formMode     = t.triggerMode
		formPreview  = null
	}

	async function loadTimers(): Promise<void> {
		loading = true
		try {
			const res = await apiFetch(fetch, '/streamer/chat-timers', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json() as { timers: ChatTimer[] }
				timers = data.timers ?? []
			}
		} finally {
			loading = false
		}
	}

	async function doPreview(): Promise<void> {
		if (!formTemplate.trim()) { formPreview = null; return }
		formBusy = true
		try {
			const res = await apiFetch(fetch, '/streamer/chat-timers/preview', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ template: formTemplate }),
			})
			if (res.ok) {
				const data = await res.json() as { rendered: string }
				formPreview = data.rendered
			} else {
				formPreview = null
			}
		} finally {
			formBusy = false
		}
	}

	async function submitForm(): Promise<void> {
		if (!formLabel.trim() || !formTemplate.trim()) {
			flash('Label et template requis.', false); return
		}
		if (formMode === 'recurring' && formInterval < 5) {
			flash('Mode récurrent : intervalle minimum 5 minutes.', false); return
		}
		if (formMode !== 'recurring' && formInterval < 1) {
			flash('Délai minimum 1 minute.', false); return
		}
		formBusy = true
		try {
			const body = {
				label:            formLabel,
				enabled:          formEnabled,
				messageTemplate:  formTemplate,
				intervalMinutes:  formInterval,
				minChatMessages:  formMinMsgs,
				liveOnly:         formLiveOnly,
				triggerMode:      formMode,
			}
			const url = editingId ? `/streamer/chat-timers/${editingId}` : '/streamer/chat-timers'
			const res = await apiFetch(fetch, url, {
				method:  editingId ? 'PATCH' : 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify(body),
			})
			if (res.ok) {
				flash(editingId ? 'Timer mis à jour.' : 'Timer créé.', true)
				resetForm()
				await loadTimers()
			} else {
				const data = await res.json().catch(() => ({ error: 'unknown' })) as { error?: string }
				flash(`Échec : ${data.error ?? 'erreur inconnue'}`, false)
			}
		} finally {
			formBusy = false
		}
	}

	async function toggleEnabled(t: ChatTimer): Promise<void> {
		const res = await apiFetch(fetch, `/streamer/chat-timers/${t.id}`, {
			method:  'PATCH',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body:    JSON.stringify({ enabled: !t.enabled }),
		})
		if (res.ok) {
			t.enabled = !t.enabled
			flash(t.enabled ? `${t.label} activé` : `${t.label} désactivé`, true)
		} else {
			flash('Échec toggle.', false)
		}
	}

	async function deleteTimer(t: ChatTimer): Promise<void> {
		if (!confirm(`Supprimer le timer "${t.label}" ?`)) return
		const res = await apiFetch(fetch, `/streamer/chat-timers/${t.id}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			timers = timers.filter(x => x.id !== t.id)
			if (editingId === t.id) resetForm()
			flash(`Timer "${t.label}" supprimé.`, true)
		} else {
			flash('Échec suppression.', false)
		}
	}

	async function sendNow(t: ChatTimer): Promise<void> {
		if (sendingNowId) return
		sendingNowId = t.id
		try {
			const res = await apiFetch(fetch, `/streamer/chat-timers/${t.id}/send-now`, {
				method:  'POST',
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json().catch(() => ({})) as { ok?: boolean; reason?: string; rendered?: string }
			if (data.ok) flash(`Envoyé : ${data.rendered ?? ''}`.slice(0, 120), true)
			else         flash(`Échec envoi : ${data.reason ?? 'inconnu'}`, false)
		} finally {
			sendingNowId = null
		}
	}

	function fmtRelative(iso: string | null): string {
		if (!iso) return 'jamais'
		const diff = Date.now() - new Date(iso).getTime()
		const m = Math.floor(diff / 60_000)
		if (m < 1)   return "à l'instant"
		if (m < 60)  return `il y a ${m}min`
		const h = Math.floor(m / 60)
		if (h < 24)  return `il y a ${h}h`
		const d = Math.floor(h / 24)
		return `il y a ${d}j`
	}

	onMount(loadTimers)
</script>

<section class="rounded-xl border border-indigo-500/25 bg-gradient-to-br from-indigo-950/30 via-slate-900/60 to-cyan-950/20 p-5 space-y-4">
	<header class="flex items-center justify-between gap-3 flex-wrap">
		<div class="flex items-center gap-2.5">
			<svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
			<h2 class="text-sm font-semibold text-white">Bot Chat — messages récurrents</h2>
			<Tooltip text="Le bot Nodyx poste automatiquement des messages dans ton chat Twitch à intervalles définis. Idéal pour rappeler !nodyx, ton schedule, tes réseaux. Configure une fois, ça tourne pendant le live." variant="tip" position="bottom"/>
		</div>
		<div class="text-[10px] text-slate-500">Variables : <code class="bg-slate-800/60 px-1 rounded">{`{nodyx_url}`}</code> <code class="bg-slate-800/60 px-1 rounded">{`{streamer}`}</code> <code class="bg-slate-800/60 px-1 rounded">{`{uptime}`}</code></div>
	</header>

	<!-- ── Presets : recettes pré-faites pour les débutants ─────────────────── -->
	<div class="rounded-lg border border-indigo-500/30 bg-indigo-950/20 p-3">
		<div class="flex items-center gap-2 mb-2">
			<svg class="w-3.5 h-3.5 text-indigo-400" fill="currentColor" viewBox="0 0 20 20"><path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"/></svg>
			<span class="text-[11px] uppercase tracking-widest font-semibold text-indigo-300">Recettes prêtes à l'emploi</span>
			<Tooltip text="Charge un timer pré-configuré dans le formulaire ci-dessous. Tu peux ensuite personnaliser avant d'enregistrer." variant="tip"/>
		</div>
		<div class="flex flex-wrap gap-1.5">
			{#each PRESETS as p (p.key)}
				<button type="button" onclick={() => applyPreset(p)} title={p.hint}
					class="group inline-flex items-center gap-1.5 text-[11px] bg-indigo-500/10 hover:bg-indigo-500/25 border border-indigo-500/40 text-indigo-100 px-2.5 py-1 rounded transition-colors">
					<span>{p.emoji}</span>
					<span class="font-medium">{p.label}</span>
				</button>
			{/each}
		</div>
	</div>

	{#if toast}
		<div class="rounded p-2 text-xs flex items-center gap-2 {toast.ok ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/40 bg-rose-500/10 text-rose-200'}">
			<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
			{toast.text}
		</div>
	{/if}

	<!-- ── Liste des timers ────────────────────────────────────────────────── -->
	{#if loading}
		<div class="text-xs text-slate-500 text-center py-6">Chargement…</div>
	{:else if timers.length === 0}
		<div class="rounded-lg border border-dashed border-slate-700/60 bg-slate-900/30 p-6 text-center text-xs text-slate-500">
			Aucun timer pour l'instant. Crée ton premier ci-dessous (par exemple, une pub Nodyx toutes les 15 minutes).
		</div>
	{:else}
		<div class="space-y-2">
			{#each timers as t (t.id)}
				<div class="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-2 {editingId === t.id ? 'ring-1 ring-indigo-500/60' : ''}">
					<div class="flex items-start justify-between gap-3 flex-wrap">
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="text-sm font-semibold text-white">{t.label}</span>
								<span class="text-[10px] px-1.5 py-0.5 rounded {t.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700/50 text-slate-400'}">{t.enabled ? 'actif' : 'inactif'}</span>
								<span class="text-[10px] px-1.5 py-0.5 rounded {t.triggerMode === 'recurring' ? 'bg-indigo-500/15 text-indigo-300' : t.triggerMode === 'once_per_live' ? 'bg-amber-500/15 text-amber-300' : 'bg-purple-500/15 text-purple-300'}">{MODE_LABELS[t.triggerMode]}</span>
								{#if t.liveOnly}<span class="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300">live only</span>{/if}
							</div>
							<div class="text-[11px] text-slate-400 mt-1 line-clamp-2" title={t.messageTemplate}>{t.messageTemplate}</div>
							<div class="text-[10px] text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
								{#if t.triggerMode === 'recurring'}
									<span>toutes les {t.intervalMinutes}min</span>
									<span>min. {t.minChatMessages} msg chat</span>
								{:else if t.triggerMode === 'once_per_live'}
									<span>{t.intervalMinutes}min après go-live</span>
								{:else}
									<span>envoi unique</span>
								{/if}
								<span>dernier envoi : {fmtRelative(t.lastSentAt)}</span>
							</div>
						</div>
						<div class="flex items-center gap-1 flex-wrap">
							<button type="button" onclick={() => sendNow(t)} disabled={sendingNowId === t.id}
								class="text-[10px] bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-30 border border-cyan-500/40 text-cyan-200 px-2 py-1 rounded transition-colors">
								▶ Envoyer
							</button>
							<button type="button" onclick={() => toggleEnabled(t)}
								class="text-[10px] bg-slate-700/40 hover:bg-slate-700/60 border border-slate-600/60 text-slate-200 px-2 py-1 rounded transition-colors">
								{t.enabled ? 'Désactiver' : 'Activer'}
							</button>
							<button type="button" onclick={() => loadTemplate(t)}
								class="text-[10px] bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/40 text-indigo-200 px-2 py-1 rounded transition-colors">
								Éditer
							</button>
							<button type="button" onclick={() => deleteTimer(t)}
								class="text-[10px] bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-200 px-2 py-1 rounded transition-colors">
								Suppr
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- ── Formulaire create / edit ────────────────────────────────────────── -->
	<div class="rounded-lg border border-slate-700/60 bg-slate-950/40 p-4 space-y-3">
		<div class="flex items-center justify-between gap-3">
			<h3 class="text-[11px] uppercase tracking-widest font-semibold text-cyan-400">
				{editingId ? 'Modifier le timer' : 'Nouveau timer'}
			</h3>
			{#if editingId}
				<button type="button" onclick={resetForm} class="text-[10px] text-slate-400 hover:text-white">↻ Réinitialiser</button>
			{/if}
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
			<div>
				<div class="flex items-center gap-1.5">
					<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Label (interne)</span>
					<Tooltip text="Nom pour t'y retrouver dans la liste. N'apparaît PAS dans le chat. Ex : 'Pub Nodyx', 'Rappel schedule'."/>
				</div>
				<input type="text" bind:value={formLabel} maxlength="100" placeholder="Pub Nodyx"
					class="mt-1 w-full rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 px-3 py-1.5 text-sm text-white outline-none transition-colors"/>
			</div>
			{#if formMode !== 'once'}
				<div>
					<div class="flex items-center gap-1.5">
						<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">
							{formMode === 'recurring' ? 'Intervalle (minutes, min. 5)' : 'Délai après go-live (minutes)'}
						</span>
						<Tooltip text={formMode === 'recurring' ? "Temps entre 2 envois. 15 min est un bon défaut. Trop court = spam. Trop long = peu de viewers le verront." : "Délai à attendre après le démarrage du stream avant d'envoyer le message. Laisse le temps aux viewers d'arriver (2-5 min recommandé)."}/>
					</div>
					<input type="number" min={formMode === 'recurring' ? 5 : 1} max="1440" bind:value={formInterval}
						class="mt-1 w-full rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 px-3 py-1.5 text-sm text-white outline-none transition-colors"/>
				</div>
			{:else}
				<div class="text-[10px] text-purple-300 bg-purple-500/10 border border-purple-500/30 rounded px-3 py-2 mt-5 self-center">
					Mode "Une seule fois" : aucun intervalle. Envoyé dès que les conditions sont OK, puis désactivation auto.
				</div>
			{/if}
		</div>

		<!-- ── Mode de déclenchement ────────────────────────────────────────── -->
		<div>
			<div class="flex items-center gap-1.5 mb-1.5">
				<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Mode de déclenchement</span>
				<Tooltip text="Récurrent = tourne en boucle. Une fois par live = uniquement au début de chaque stream (idéal phrase d'accueil). Une seule fois = envoi unique puis désactivation auto (annonce ponctuelle)." variant="tip"/>
			</div>
			<div class="grid grid-cols-1 md:grid-cols-3 gap-2">
				{#each (['recurring', 'once_per_live', 'once'] as TriggerMode[]) as mode (mode)}
					<label class="cursor-pointer rounded-lg border p-2.5 transition-colors {formMode === mode ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-700/60 bg-slate-950/40 hover:border-slate-600'}">
						<div class="flex items-center gap-2">
							<input type="radio" name="trigger-mode" value={mode} bind:group={formMode}
								class="w-3 h-3 accent-cyan-500"/>
							<span class="text-xs font-semibold text-white">{MODE_LABELS[mode]}</span>
						</div>
						<div class="text-[10px] text-slate-400 mt-1 leading-snug">{MODE_DESCS[mode]}</div>
					</label>
				{/each}
			</div>
		</div>

		<div>
			<div class="flex items-center justify-between gap-2 flex-wrap">
				<div class="flex items-center gap-1.5">
					<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Template du message</span>
					<Tooltip text="Ce que le bot va dire dans le chat Twitch. Tu peux insérer des variables avec les boutons à droite : elles seront remplacées par les vraies valeurs au moment de l'envoi. 500 chars max."/>
				</div>
				<div class="flex items-center gap-1 flex-wrap">
					{#each INSERTABLE_VARS as v (v.token)}
						<button type="button" onclick={() => insertVar(v.token)} title={v.desc}
							class="text-[10px] bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/40 text-indigo-200 px-2 py-0.5 rounded transition-colors">
							+ {v.label} <code class="text-[9px] opacity-60 ml-0.5">{v.token}</code>
						</button>
					{/each}
				</div>
			</div>
			<textarea bind:this={templateInputEl} bind:value={formTemplate} maxlength="500" rows="3" placeholder="Rejoins la communauté Nodyx : {`{nodyx_url}`} — tape !nodyx pour le lien"
				class="mt-1 w-full rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 px-3 py-2 text-sm text-white outline-none transition-colors resize-none"></textarea>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
			{#if formMode === 'recurring'}
				<div>
					<div class="flex items-center gap-1.5">
						<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Min. messages chat depuis dernier envoi</span>
						<Tooltip text="Évite que le bot parle dans le vide. Le timer skip son envoi si moins de X messages humains depuis la dernière fois. 5 est un bon défaut. 0 = pas de check."/>
					</div>
					<input type="number" min="0" max="1000" bind:value={formMinMsgs}
						class="mt-1 w-full rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 px-3 py-1.5 text-sm text-white outline-none transition-colors"/>
					<span class="text-[10px] text-slate-500 mt-0.5 block">Anti-spam chat vide. 0 = pas de check.</span>
				</div>
			{:else}
				<div class="text-[10px] text-slate-500 self-center md:col-span-1">
					{#if formMode === 'once_per_live'}
						L'anti-spam chat vide est désactivé en mode "Une fois par live" pour garantir l'envoi du message d'accueil.
					{:else}
						L'anti-spam chat vide est désactivé en mode "Une seule fois".
					{/if}
				</div>
			{/if}
			<div class="flex items-center gap-2 mt-5">
				<label class="flex items-center gap-2 cursor-pointer">
					<input type="checkbox" bind:checked={formLiveOnly} class="w-4 h-4 accent-cyan-500"/>
					<span class="text-xs text-slate-300">Live only (skip si offline)</span>
				</label>
				<Tooltip text="Si activé, le timer ne fonctionne QUE quand tu es en stream. Recommandé : ça évite les messages bot envoyés à un chat vide quand tu es offline."/>
			</div>
			<div class="flex items-center gap-2 mt-5">
				<label class="flex items-center gap-2 cursor-pointer">
					<input type="checkbox" bind:checked={formEnabled} class="w-4 h-4 accent-emerald-500"/>
					<span class="text-xs text-slate-300">Activé dès création</span>
				</label>
				<Tooltip text="Décoche pour créer un timer sans le démarrer (utile pour préparer un brouillon)."/>
			</div>
		</div>

		<!-- Preview -->
		<div class="flex items-center gap-2 flex-wrap">
			<button type="button" onclick={doPreview} disabled={formBusy || !formTemplate.trim()}
				class="text-[11px] bg-slate-700/40 hover:bg-slate-700/60 disabled:opacity-30 border border-slate-600/60 text-slate-200 px-3 py-1.5 rounded transition-colors">
				👁 Aperçu rendu
			</button>
			{#if formPreview}
				<div class="flex-1 min-w-0 text-[11px] text-emerald-200 bg-emerald-500/10 border border-emerald-500/30 rounded px-3 py-1.5 truncate" title={formPreview}>
					{formPreview}
				</div>
			{/if}
		</div>

		<div class="flex items-center gap-2 pt-1">
			<button type="button" onclick={submitForm} disabled={formBusy || !formLabel.trim() || !formTemplate.trim()}
				class="text-xs bg-indigo-500/20 hover:bg-indigo-500/30 disabled:opacity-30 border border-indigo-500/50 text-indigo-100 px-4 py-1.5 rounded font-semibold transition-colors">
				{editingId ? 'Enregistrer' : 'Créer le timer'}
			</button>
			{#if editingId}
				<button type="button" onclick={resetForm}
					class="text-xs bg-slate-700/40 hover:bg-slate-700/60 border border-slate-600/60 text-slate-200 px-3 py-1.5 rounded transition-colors">
					Annuler
				</button>
			{/if}
		</div>
	</div>
</section>
