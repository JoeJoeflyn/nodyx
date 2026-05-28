<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { onMount } from 'svelte'
	import Tooltip from '$lib/components/ui/Tooltip.svelte'

	// Bot Chat — commandes custom : commandes éditables côté admin avec
	// template de réponse. Les commandes hardcoded (renvoyées par le backend)
	// sont affichées en lecture seule pour info.

	interface Props {
		token: string
	}

	let { token }: Props = $props()

	interface CustomCommand {
		id:                string
		name:              string
		enabled:           boolean
		responseTemplate:  string
		modOnly:           boolean
		cooldownSeconds:   number
		createdAt:         string
		updatedAt:         string
	}

	let commands           = $state<CustomCommand[]>([])
	let hardcoded          = $state<string[]>([])
	let loading            = $state(true)
	let toast              = $state<{ text: string; ok: boolean } | null>(null)

	// Form state
	let editingId          = $state<string | null>(null)
	let formName           = $state('')
	let formTemplate       = $state('')
	let formModOnly        = $state(false)
	let formCooldown       = $state(30)
	let formEnabled        = $state(true)
	let formBusy           = $state(false)
	let templateInputEl    = $state<HTMLTextAreaElement | null>(null)

	const INSERTABLE_VARS = [
		{ token: '{nodyx_url}', label: 'Lien Nodyx' },
		{ token: '{streamer}',  label: 'Streamer'   },
		{ token: '{uptime}',    label: 'Uptime'     },
	]

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3500)
	}

	function resetForm(): void {
		editingId    = null
		formName     = ''
		formTemplate = ''
		formModOnly  = false
		formCooldown = 30
		formEnabled  = true
	}

	function loadCmd(c: CustomCommand): void {
		editingId    = c.id
		formName     = c.name
		formTemplate = c.responseTemplate
		formModOnly  = c.modOnly
		formCooldown = c.cooldownSeconds
		formEnabled  = c.enabled
	}

	// ── Presets : commandes prêtes à l'emploi ──────────────────────────────
	interface CmdPreset {
		key:    string
		name:   string
		emoji:  string
		hint:   string
		fill: () => void
	}

	const PRESETS: CmdPreset[] = [
		{
			key: 'discord', name: '!discord', emoji: '💬',
			hint: 'Réponse cheeky pour les viewers qui demandent ton Discord',
			fill: () => {
				formName     = '!discord'
				formTemplate = "Pas de Discord chez nous, on a mieux : Nodyx ! Rejoins-nous : {nodyx_url}"
				formModOnly  = false
				formCooldown = 30
				formEnabled  = true
			},
		},
		{
			key: 'schedule', name: '!schedule', emoji: '📅',
			hint: "Horaires de stream",
			fill: () => {
				formName     = '!schedule'
				formTemplate = "Stream tous les soirs à 21h (heure de Paris). Pense à follow pour ne rien rater !"
				formModOnly  = false
				formCooldown = 30
				formEnabled  = true
			},
		},
		{
			key: 'social', name: '!social', emoji: '🔗',
			hint: 'Tous tes réseaux en un message',
			fill: () => {
				formName     = '!social'
				formTemplate = "Retrouve-moi sur Nodyx ({nodyx_url}) et sur mes autres réseaux. Tape !nodyx pour la commu directement."
				formModOnly  = false
				formCooldown = 60
				formEnabled  = true
			},
		},
		{
			key: 'lurk', name: '!lurk', emoji: '👀',
			hint: 'Pour les viewers qui passent en arrière-plan',
			fill: () => {
				formName     = '!lurk'
				formTemplate = "Merci d'être là en mode lurk, ça booste le stream. Bonne journée !"
				formModOnly  = false
				formCooldown = 15
				formEnabled  = true
			},
		},
		{
			key: 'tipeee', name: '!soutien', emoji: '💛',
			hint: 'Lien de soutien (Tipeee, Patreon, etc.) à personnaliser',
			fill: () => {
				formName     = '!soutien'
				formTemplate = "Merci de soutenir le stream ! Plus d'infos sur {nodyx_url} (et remplace ce template par ton lien Tipeee/Patreon)"
				formModOnly  = false
				formCooldown = 60
				formEnabled  = true
			},
		},
		{
			key: 'projet', name: '!projet', emoji: '🛠️',
			hint: 'Présentation de ton projet en cours',
			fill: () => {
				formName     = '!projet'
				formTemplate = "Sur quoi je bosse : (édite ce message dans l'admin Nodyx). Tape !nodyx pour rejoindre la commu."
				formModOnly  = false
				formCooldown = 60
				formEnabled  = true
			},
		},
	]

	function applyPreset(p: CmdPreset): void {
		editingId = null
		p.fill()
		flash(`Preset "${p.name}" chargé. Personnalise puis enregistre.`, true)
	}

	function insertVar(tok: string): void {
		const el = templateInputEl
		if (!el) {
			formTemplate = formTemplate + (formTemplate && !formTemplate.endsWith(' ') ? ' ' : '') + tok
			return
		}
		const s = el.selectionStart ?? formTemplate.length
		const e = el.selectionEnd   ?? formTemplate.length
		formTemplate = formTemplate.slice(0, s) + tok + formTemplate.slice(e)
		setTimeout(() => { el.focus(); const p = s + tok.length; el.setSelectionRange(p, p) }, 0)
	}

	async function loadAll(): Promise<void> {
		loading = true
		try {
			const res = await apiFetch(fetch, '/streamer/chat-commands', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json() as { commands: CustomCommand[]; hardcoded: string[] }
				commands  = data.commands  ?? []
				hardcoded = data.hardcoded ?? []
			}
		} finally {
			loading = false
		}
	}

	async function submitForm(): Promise<void> {
		const normalized = formName.trim().toLowerCase()
		if (!/^![a-z0-9_-]{1,30}$/.test(normalized)) {
			flash("Nom invalide. Format : !nom (lettres ASCII, chiffres, _, -, 1-30 chars).", false); return
		}
		if (!formTemplate.trim()) { flash('Template requis.', false); return }
		if (hardcoded.includes(normalized) && (!editingId || commands.find(c => c.id === editingId)?.name !== normalized)) {
			flash(`"${normalized}" est une commande native, choisis un autre nom.`, false); return
		}
		formBusy = true
		try {
			const body = {
				name:              normalized,
				enabled:           formEnabled,
				responseTemplate:  formTemplate,
				modOnly:           formModOnly,
				cooldownSeconds:   formCooldown,
			}
			const url    = editingId ? `/streamer/chat-commands/${editingId}` : '/streamer/chat-commands'
			const method = editingId ? 'PATCH' : 'POST'
			const res = await apiFetch(fetch, url, {
				method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify(body),
			})
			if (res.ok) {
				flash(editingId ? 'Commande mise à jour.' : 'Commande créée.', true)
				resetForm()
				await loadAll()
			} else {
				const data = await res.json().catch(() => ({})) as { error?: string }
				const msg =
					data.error === 'name_reserved_hardcoded' ? 'Ce nom est réservé à une commande native.' :
					data.error === 'name_already_used'       ? 'Ce nom est déjà utilisé.' :
					data.error === 'invalid_name'            ? 'Nom invalide.' :
					data.error ?? 'Erreur inconnue'
				flash(`Échec : ${msg}`, false)
			}
		} finally {
			formBusy = false
		}
	}

	async function toggleEnabled(c: CustomCommand): Promise<void> {
		const res = await apiFetch(fetch, `/streamer/chat-commands/${c.id}`, {
			method:  'PATCH',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body:    JSON.stringify({ enabled: !c.enabled }),
		})
		if (res.ok) { c.enabled = !c.enabled; flash(c.enabled ? `${c.name} activée` : `${c.name} désactivée`, true) }
		else flash('Échec toggle.', false)
	}

	async function removeCmd(c: CustomCommand): Promise<void> {
		if (!confirm(`Supprimer la commande "${c.name}" ?`)) return
		const res = await apiFetch(fetch, `/streamer/chat-commands/${c.id}`, {
			method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			commands = commands.filter(x => x.id !== c.id)
			if (editingId === c.id) resetForm()
			flash(`Commande "${c.name}" supprimée.`, true)
		} else flash('Échec suppression.', false)
	}

	onMount(loadAll)
</script>

<section class="rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-950/30 via-slate-900/60 to-fuchsia-950/20 p-5 space-y-4">
	<header class="flex items-center justify-between gap-3 flex-wrap">
		<div class="flex items-center gap-2.5">
			<svg class="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
			<h2 class="text-sm font-semibold text-white">Commandes custom</h2>
			<Tooltip text="Crée tes propres commandes !xxx que les viewers taperont dans le chat. Le bot Nodyx leur répondra avec ton template. Idéal pour !discord, !schedule, !social, !merch, etc." variant="tip" position="bottom"/>
		</div>
		<div class="text-[10px] text-slate-500">Variables : <code class="bg-slate-800/60 px-1 rounded">{`{nodyx_url}`}</code> <code class="bg-slate-800/60 px-1 rounded">{`{streamer}`}</code> <code class="bg-slate-800/60 px-1 rounded">{`{uptime}`}</code></div>
	</header>

	<!-- ── Presets : commandes prêtes à l'emploi ──────────────────────────── -->
	<div class="rounded-lg border border-violet-500/30 bg-violet-950/20 p-3">
		<div class="flex items-center gap-2 mb-2">
			<svg class="w-3.5 h-3.5 text-violet-400" fill="currentColor" viewBox="0 0 20 20"><path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"/></svg>
			<span class="text-[11px] uppercase tracking-widest font-semibold text-violet-300">Commandes prêtes à l'emploi</span>
			<Tooltip text="Charge une commande pré-configurée dans le formulaire ci-dessous. Personnalise puis enregistre." variant="tip"/>
		</div>
		<div class="flex flex-wrap gap-1.5">
			{#each PRESETS as p (p.key)}
				<button type="button" onclick={() => applyPreset(p)} title={p.hint}
					class="group inline-flex items-center gap-1.5 text-[11px] bg-violet-500/10 hover:bg-violet-500/25 border border-violet-500/40 text-violet-100 px-2.5 py-1 rounded transition-colors">
					<span>{p.emoji}</span>
					<code class="font-mono font-medium">{p.name}</code>
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

	<!-- Commandes natives en lecture seule -->
	{#if hardcoded.length > 0}
		<div class="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
			<div class="flex items-center gap-1.5 mb-1.5">
				<span class="text-[10px] uppercase tracking-widest font-semibold text-slate-400">Commandes natives (non modifiables)</span>
				<Tooltip text="Ces commandes sont intégrées au cœur de Nodyx et ont leur propre logique (lookup Twitch, query DB, etc.). Tu ne peux pas créer une commande custom avec un de ces noms." size="sm"/>
			</div>
			<div class="flex flex-wrap gap-1.5">
				{#each hardcoded as n (n)}
					<code class="text-[11px] bg-indigo-500/15 border border-indigo-500/30 text-indigo-200 px-2 py-0.5 rounded">{n}</code>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Liste des commandes custom -->
	{#if loading}
		<div class="text-xs text-slate-500 text-center py-6">Chargement…</div>
	{:else if commands.length === 0}
		<div class="rounded-lg border border-dashed border-slate-700/60 bg-slate-900/30 p-6 text-center text-xs text-slate-500">
			Aucune commande custom. Crée-en une ci-dessous (par exemple !discord, !schedule, !merch).
		</div>
	{:else}
		<div class="space-y-2">
			{#each commands as c (c.id)}
				<div class="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-1 {editingId === c.id ? 'ring-1 ring-violet-500/60' : ''}">
					<div class="flex items-start justify-between gap-3 flex-wrap">
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<code class="text-sm font-mono font-semibold text-white">{c.name}</code>
								<span class="text-[10px] px-1.5 py-0.5 rounded {c.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700/50 text-slate-400'}">{c.enabled ? 'actif' : 'inactif'}</span>
								{#if c.modOnly}<span class="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300">mod only</span>{/if}
								<span class="text-[10px] text-slate-500">cooldown {c.cooldownSeconds}s</span>
							</div>
							<div class="text-[11px] text-slate-400 mt-1 line-clamp-2" title={c.responseTemplate}>{c.responseTemplate}</div>
						</div>
						<div class="flex items-center gap-1 flex-wrap">
							<button type="button" onclick={() => toggleEnabled(c)}
								class="text-[10px] bg-slate-700/40 hover:bg-slate-700/60 border border-slate-600/60 text-slate-200 px-2 py-1 rounded transition-colors">
								{c.enabled ? 'Désactiver' : 'Activer'}
							</button>
							<button type="button" onclick={() => loadCmd(c)}
								class="text-[10px] bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/40 text-violet-200 px-2 py-1 rounded transition-colors">
								Éditer
							</button>
							<button type="button" onclick={() => removeCmd(c)}
								class="text-[10px] bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-200 px-2 py-1 rounded transition-colors">
								Suppr
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Formulaire create / edit -->
	<div class="rounded-lg border border-slate-700/60 bg-slate-950/40 p-4 space-y-3">
		<div class="flex items-center justify-between gap-3">
			<h3 class="text-[11px] uppercase tracking-widest font-semibold text-violet-400">
				{editingId ? 'Modifier la commande' : 'Nouvelle commande'}
			</h3>
			{#if editingId}
				<button type="button" onclick={resetForm} class="text-[10px] text-slate-400 hover:text-white">↻ Réinitialiser</button>
			{/if}
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
			<div>
				<div class="flex items-center gap-1.5">
					<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Nom (commencer par !)</span>
					<Tooltip text="Le texte que les viewers tapent dans le chat. Doit commencer par !, suivi de lettres, chiffres, _ ou -. Pas d'espace. Ex : !discord, !schedule, !merch."/>
				</div>
				<input type="text" bind:value={formName} maxlength="31" placeholder="!discord"
					class="mt-1 w-full rounded bg-slate-950 border border-slate-700/60 focus:border-violet-500/60 px-3 py-1.5 text-sm font-mono text-white outline-none transition-colors"/>
			</div>
			<div>
				<div class="flex items-center gap-1.5">
					<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Cooldown (secondes, 5-3600)</span>
					<Tooltip text="Délai minimum entre 2 réponses du bot pour cette commande. Évite qu'un viewer spamme !discord 10x d'affilée. 30s est un bon défaut."/>
				</div>
				<input type="number" min="5" max="3600" bind:value={formCooldown}
					class="mt-1 w-full rounded bg-slate-950 border border-slate-700/60 focus:border-violet-500/60 px-3 py-1.5 text-sm text-white outline-none transition-colors"/>
			</div>
		</div>

		<div>
			<div class="flex items-center justify-between gap-2 flex-wrap">
				<div class="flex items-center gap-1.5">
					<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Réponse du bot</span>
					<Tooltip text="Ce que le bot répond quand un viewer tape la commande. Tu peux insérer des variables qui seront remplacées par les vraies valeurs au moment de l'envoi. 500 chars max."/>
				</div>
				<div class="flex items-center gap-1 flex-wrap">
					{#each INSERTABLE_VARS as v (v.token)}
						<button type="button" onclick={() => insertVar(v.token)}
							class="text-[10px] bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/40 text-violet-200 px-2 py-0.5 rounded transition-colors">
							+ {v.label}
						</button>
					{/each}
				</div>
			</div>
			<textarea bind:this={templateInputEl} bind:value={formTemplate} maxlength="500" rows="3" placeholder="Rejoins notre Discord : https://..."
				class="mt-1 w-full rounded bg-slate-950 border border-slate-700/60 focus:border-violet-500/60 px-3 py-2 text-sm text-white outline-none transition-colors resize-none"></textarea>
		</div>

		<div class="flex items-center gap-4 flex-wrap">
			<div class="flex items-center gap-2">
				<label class="flex items-center gap-2 cursor-pointer">
					<input type="checkbox" bind:checked={formModOnly} class="w-4 h-4 accent-rose-500"/>
					<span class="text-xs text-slate-300">Mod / Streamer only</span>
				</label>
				<Tooltip text="Si activé, seuls toi et tes modérateurs peuvent déclencher cette commande. Pratique pour des commandes admin (genre nettoyer le chat) que tu ne veux pas exposer aux viewers."/>
			</div>
			<div class="flex items-center gap-2">
				<label class="flex items-center gap-2 cursor-pointer">
					<input type="checkbox" bind:checked={formEnabled} class="w-4 h-4 accent-emerald-500"/>
					<span class="text-xs text-slate-300">Activée dès création</span>
				</label>
				<Tooltip text="Décoche pour créer une commande sans qu'elle soit utilisable (utile pour préparer un brouillon)."/>
			</div>
		</div>

		<div class="flex items-center gap-2 pt-1">
			<button type="button" onclick={submitForm} disabled={formBusy || !formName.trim() || !formTemplate.trim()}
				class="text-xs bg-violet-500/20 hover:bg-violet-500/30 disabled:opacity-30 border border-violet-500/50 text-violet-100 px-4 py-1.5 rounded font-semibold transition-colors">
				{editingId ? 'Enregistrer' : 'Créer la commande'}
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
