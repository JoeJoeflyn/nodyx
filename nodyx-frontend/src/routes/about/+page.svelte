<script lang="ts">
	import type { PageData } from './$types'
	let { data }: { data: PageData & { nodyxVersion?: string } } = $props()

	const version = $derived((data as any).nodyxVersion ?? 'unknown')
	const releaseUrl = $derived(
		version && version !== 'unknown'
			? `https://github.com/Pokled/Nodyx/releases/tag/v${version}`
			: 'https://github.com/Pokled/Nodyx/releases'
	)
</script>

<svelte:head>
	<title>À propos de Nodyx</title>
</svelte:head>

<div class="max-w-2xl mx-auto px-6 py-12">

	<div class="flex items-center gap-4 mb-8">
		<img
			src="/nodyx-octopus.png"
			alt="Nodyx"
			class="h-16 w-16 object-contain"
		/>
		<div>
			<h1 class="text-3xl font-bold text-white tracking-tight">Nodyx</h1>
			<p class="text-sm text-zinc-400 font-mono mt-0.5">v{version}</p>
		</div>
	</div>

	<p class="text-zinc-300 leading-relaxed mb-8">
		Plateforme communautaire libre, auto-hébergée et décentralisée.
		Forum + chat temps réel + vocal, sans GAFAM, sans analytics, sans silos.
		Une instance = une communauté.
	</p>

	<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
		<a
			href={releaseUrl}
			target="_blank"
			rel="noopener noreferrer"
			class="block p-4 rounded-lg border border-zinc-800 hover:border-zinc-600 transition-colors bg-zinc-900/40"
		>
			<div class="text-xs uppercase tracking-wider text-zinc-500 mb-1">Cette release</div>
			<div class="text-sm font-mono text-white">v{version}</div>
			<div class="text-xs text-zinc-500 mt-2">Voir les notes sur GitHub →</div>
		</a>

		<a
			href={data.changelogUrl}
			target="_blank"
			rel="noopener noreferrer"
			class="block p-4 rounded-lg border border-zinc-800 hover:border-zinc-600 transition-colors bg-zinc-900/40"
		>
			<div class="text-xs uppercase tracking-wider text-zinc-500 mb-1">Historique</div>
			<div class="text-sm font-mono text-white">CHANGELOG.md</div>
			<div class="text-xs text-zinc-500 mt-2">Toutes les versions →</div>
		</a>

		<a
			href={data.repoUrl}
			target="_blank"
			rel="noopener noreferrer"
			class="block p-4 rounded-lg border border-zinc-800 hover:border-zinc-600 transition-colors bg-zinc-900/40"
		>
			<div class="text-xs uppercase tracking-wider text-zinc-500 mb-1">Code source</div>
			<div class="text-sm font-mono text-white">Pokled/Nodyx</div>
			<div class="text-xs text-zinc-500 mt-2">github.com →</div>
		</a>

		<a
			href={data.licenseUrl}
			target="_blank"
			rel="noopener noreferrer"
			class="block p-4 rounded-lg border border-zinc-800 hover:border-zinc-600 transition-colors bg-zinc-900/40"
		>
			<div class="text-xs uppercase tracking-wider text-zinc-500 mb-1">Licence</div>
			<div class="text-sm font-mono text-white">{data.licenseName}</div>
			<div class="text-xs text-zinc-500 mt-2">GNU AGPL v3 →</div>
		</a>
	</div>

	<div class="text-xs text-zinc-500 leading-relaxed border-t border-zinc-800 pt-6">
		Nodyx est un logiciel libre publié sous licence AGPL-3.0. Toute modification
		déployée publiquement doit être partagée sous la même licence. Aucune télémétrie
		n'est envoyée à un service tiers. Les données de cette instance restent sur le
		serveur qui l'héberge.
	</div>

</div>
