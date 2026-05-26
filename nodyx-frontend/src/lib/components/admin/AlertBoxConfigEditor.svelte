<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import AlertThemePreview from './AlertThemePreview.svelte'

	type AlertTheme = 'cyber' | 'soft' | 'retro' | 'neon' | 'holographic' | 'minimal' | 'custom'
	type AlertEventKey =
		| 'channel.follow' | 'channel.subscribe' | 'channel.subscription.gift'
		| 'channel.cheer'  | 'channel.raid'
	type AlertEventCfg = { enabled: boolean; template: string; iconUrl?: string | null }
	type CustomTheme = {
		bgImageUrl?:  string | null
		bgColor?:     string | null
		accentColor?: string | null
		textColor?:   string | null
	}
	type AlertConfig = {
		theme:        AlertTheme
		durationMs:   number
		events:       Record<AlertEventKey, AlertEventCfg>
		customTheme:  CustomTheme
	}

	interface Props {
		token:      string
		overlayId:  string
		initial:    Record<string, unknown> | null
		onSaved?:   () => void
	}

	let { token, overlayId, initial, onSaved }: Props = $props()

	const VALID_THEMES = ['cyber', 'soft', 'retro', 'neon', 'holographic', 'minimal', 'custom'] as const

	const DEFAULTS: AlertConfig = {
		theme:      'cyber',
		durationMs: 5000,
		events: {
			'channel.follow':            { enabled: true, template: '{user_name} a follow !',                                         iconUrl: null },
			'channel.subscribe':         { enabled: true, template: '{user_name} s\'abonne (tier {tier}) !',                          iconUrl: null },
			'channel.subscription.gift': { enabled: true, template: '{user_name} offre {total} sub{total_plural} !',                   iconUrl: null },
			'channel.cheer':             { enabled: true, template: '{user_name} envoie {bits} bits !',                               iconUrl: null },
			'channel.raid':              { enabled: true, template: 'Raid de {from_broadcaster_user_name} avec {viewers} viewers !', iconUrl: null },
		},
		customTheme: { bgImageUrl: null, bgColor: null, accentColor: null, textColor: null },
	}

	function merge(raw: Record<string, unknown> | null): AlertConfig {
		const cfg = raw ?? {}
		const events = JSON.parse(JSON.stringify(DEFAULTS.events)) as AlertConfig['events']
		const rawEvents = (cfg.events ?? {}) as Record<string, Partial<AlertEventCfg>>
		for (const k of Object.keys(events) as AlertEventKey[]) {
			const inc = rawEvents[k]
			if (inc) events[k] = {
				enabled:  typeof inc.enabled  === 'boolean' ? inc.enabled  : events[k].enabled,
				template: typeof inc.template === 'string'  ? inc.template : events[k].template,
				iconUrl:  typeof inc.iconUrl  === 'string'  ? inc.iconUrl  : null,
			}
		}
		const theme = (VALID_THEMES as readonly string[]).includes(cfg.theme as string)
			? cfg.theme as AlertTheme : DEFAULTS.theme
		const durationMs = typeof cfg.durationMs === 'number' && cfg.durationMs >= 1000 && cfg.durationMs <= 30000
			? cfg.durationMs : DEFAULTS.durationMs
		const ct = (cfg.customTheme ?? {}) as Partial<CustomTheme>
		const customTheme: CustomTheme = {
			bgImageUrl:  typeof ct.bgImageUrl  === 'string' ? ct.bgImageUrl  : null,
			bgColor:     typeof ct.bgColor     === 'string' ? ct.bgColor     : null,
			accentColor: typeof ct.accentColor === 'string' ? ct.accentColor : null,
			textColor:   typeof ct.textColor   === 'string' ? ct.textColor   : null,
		}
		return { theme, durationMs, events, customTheme }
	}

	let config = $state<AlertConfig>(merge(initial))
	let saving = $state(false)
	let firing = $state<string | null>(null)
	let toast  = $state<{ text: string; ok: boolean } | null>(null)

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3000)
	}

	async function save(): Promise<void> {
		if (saving) return
		saving = true
		try {
			const res = await apiFetch(fetch, `/streamer/overlays/${overlayId}`, {
				method:  'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ config }),
			})
			if (res.ok) {
				flash('Config sauvegardée. L\'overlay applique automatiquement.', true)
				onSaved?.()
			} else flash('Échec de la sauvegarde.', false)
		} catch {
			flash('Erreur réseau.', false)
		} finally {
			saving = false
		}
	}

	async function testFire(evtType: AlertEventKey): Promise<void> {
		if (firing) return
		firing = evtType
		try {
			const res = await apiFetch(fetch, `/streamer/overlays/${overlayId}/test-fire`, {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ eventType: evtType }),
			})
			if (res.ok) flash('Event factice envoyé. Vérifie l\'overlay.', true)
			else flash('Test-fire échoué.', false)
		} catch {
			flash('Erreur réseau.', false)
		} finally {
			firing = null
		}
	}

	const EVENT_META: Record<AlertEventKey, { label: string; accent: string; vars: string[] }> = {
		'channel.follow':            { label: 'Follow',     accent: '#06b6d4', vars: ['user_name', 'user_login'] },
		'channel.subscribe':         { label: 'Subscribe',  accent: '#a855f7', vars: ['user_name', 'tier'] },
		'channel.subscription.gift': { label: 'Gift sub',   accent: '#ec4899', vars: ['user_name', 'total', 'total_plural'] },
		'channel.cheer':             { label: 'Bits',       accent: '#f59e0b', vars: ['user_name', 'bits'] },
		'channel.raid':              { label: 'Raid',       accent: '#ef4444', vars: ['from_broadcaster_user_name', 'viewers'] },
	}

	const THEME_META: Record<AlertTheme, { label: string; tagline: string }> = {
		cyber:        { label: 'Cyber',        tagline: 'Sombre · accent gradient · style Nodyx' },
		soft:         { label: 'Soft',         tagline: 'Blanc rond · doux · glassmorphism' },
		retro:        { label: 'Retro',        tagline: 'Pixel · gras · contour épais' },
		neon:         { label: 'Neon',         tagline: 'Glow pulsant · couleur saturée' },
		holographic:  { label: 'Holographic',  tagline: 'Gradient iridescent animé' },
		minimal:      { label: 'Minimal',      tagline: 'Texte seul · gros gras · ombre' },
		custom:       { label: 'Custom',       tagline: 'Tes propres images et couleurs' },
	}
</script>

<div class="rounded-lg border border-slate-700/40 bg-slate-950/60 p-4 space-y-4 mt-3">
	{#if toast}
		<div class="rounded p-2 text-xs flex items-center gap-2 {toast.ok ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/40 bg-rose-500/10 text-rose-200'}">
			<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
			{toast.text}
		</div>
	{/if}

	<!-- Theme picker avec preview live de chaque thème -->
	<div>
		<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">Thème</div>
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
			{#each Object.entries(THEME_META) as [k, m] (k)}
				{@const isActive = config.theme === k}
				<button type="button" onclick={() => config.theme = k as AlertTheme}
					class="text-left rounded-lg border p-2 transition-colors {isActive ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-700/60 bg-slate-900/50 hover:border-slate-600/80'}">
					<AlertThemePreview
						theme={k as AlertTheme}
						customTheme={k === 'custom' ? config.customTheme : undefined}
					/>
					<div class="mt-2">
						<div class="text-xs font-semibold {isActive ? 'text-cyan-200' : 'text-slate-200'}">{m.label}</div>
						<div class="text-[10px] text-slate-500 mt-0.5 leading-snug">{m.tagline}</div>
					</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- Custom theme panel (apparait uniquement si theme = custom) -->
	{#if config.theme === 'custom'}
		<div class="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 space-y-3">
			<div class="text-[11px] uppercase tracking-widest font-semibold text-cyan-400">Paramètres custom</div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">URL image de fond</span>
					<input type="url" bind:value={config.customTheme.bgImageUrl}
						placeholder="https://exemple.com/bg.png"
						class="w-full rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
				</label>
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Couleur de fond (fallback)</span>
					<div class="flex gap-1.5">
						<input type="color" bind:value={config.customTheme.bgColor}
							class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
						<input type="text" bind:value={config.customTheme.bgColor} placeholder="#0f172a"
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
					</div>
				</label>
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Couleur d'accent</span>
					<div class="flex gap-1.5">
						<input type="color" bind:value={config.customTheme.accentColor}
							class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
						<input type="text" bind:value={config.customTheme.accentColor} placeholder="#06b6d4"
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
					</div>
				</label>
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Couleur du texte</span>
					<div class="flex gap-1.5">
						<input type="color" bind:value={config.customTheme.textColor}
							class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
						<input type="text" bind:value={config.customTheme.textColor} placeholder="#f1f5f9"
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
					</div>
				</label>
			</div>
			<div class="text-[10px] text-slate-500 leading-relaxed">
				Conseil : héberge tes images sur Nodyx (galerie, post) ou n'importe quel CDN en HTTPS (Imgur, Cloudinary, etc). Le PNG/WebP transparent est idéal pour superposer sur ton stream.
			</div>
		</div>
	{/if}

	<!-- Duration -->
	<div>
		<label for="alert-duration" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">
			Durée d'affichage : <span class="text-cyan-300 font-mono">{(config.durationMs / 1000).toFixed(1)}s</span>
		</label>
		<input id="alert-duration" type="range" min="1000" max="15000" step="500" bind:value={config.durationMs}
			class="w-full accent-cyan-500"/>
		<div class="flex justify-between text-[10px] text-slate-600 font-mono mt-0.5"><span>1s</span><span>15s</span></div>
	</div>

	<!-- Events -->
	<div>
		<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">Templates par type d'event</div>
		<div class="space-y-2">
			{#each Object.entries(EVENT_META) as [k, m] (k)}
				{@const key = k as AlertEventKey}
				{@const cfg = config.events[key]}
				<div class="rounded-lg border border-slate-700/40 bg-slate-900/50 p-3 space-y-2">
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-2 flex-1 min-w-0">
							<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background: {m.accent}"></span>
							<span class="text-sm font-medium text-white">{m.label}</span>
							<span class="text-[10px] text-slate-500 font-mono truncate">{key}</span>
						</div>
						<label class="flex items-center gap-1.5 cursor-pointer shrink-0">
							<input type="checkbox" bind:checked={config.events[key].enabled} class="accent-cyan-500"/>
							<span class="text-[11px] text-slate-400">{cfg.enabled ? 'Activé' : 'Désactivé'}</span>
						</label>
					</div>
					<input type="text" bind:value={config.events[key].template} maxlength="160"
						disabled={!cfg.enabled}
						placeholder="Template avec variables {'{user_name}'} etc"
						class="w-full rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-sm text-white placeholder-slate-600 outline-none transition-colors disabled:opacity-40 font-mono"/>
					{#if config.theme === 'custom'}
						<div class="flex items-center gap-2">
							<input type="url" bind:value={config.events[key].iconUrl}
								disabled={!cfg.enabled}
								placeholder="URL icône custom pour cet event (optionnel)"
								class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-[11px] text-white placeholder-slate-600 outline-none transition-colors disabled:opacity-40 font-mono"/>
							{#if cfg.iconUrl}
								<img src={cfg.iconUrl} alt="" class="w-8 h-8 rounded object-cover border border-slate-700/60" />
							{/if}
						</div>
					{/if}
					<div class="flex items-center justify-between gap-2 text-[10px]">
						<div class="text-slate-500">
							Variables :
							{#each m.vars as v, i}
								<code class="font-mono text-cyan-400/80">{`{${v}}`}</code>{#if i < m.vars.length - 1}<span class="text-slate-700"> · </span>{/if}
							{/each}
						</div>
						<button type="button" onclick={() => testFire(key)} disabled={firing !== null || !cfg.enabled}
							class="rounded bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-30 border border-amber-500/40 text-amber-200 px-2 py-1 text-[10px] font-medium transition-colors inline-flex items-center gap-1">
							{#if firing === key}
								<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
								Test…
							{:else}
								<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/></svg>
								Tester
							{/if}
						</button>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<button type="button" onclick={save} disabled={saving}
		class="w-full rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-30 border border-cyan-500/40 text-cyan-200 font-medium px-4 py-2 text-sm transition-colors">
		{saving ? 'Sauvegarde…' : 'Sauvegarder la config'}
	</button>
</div>
