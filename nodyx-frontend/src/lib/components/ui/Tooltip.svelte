<script lang="ts">
	// Tooltip discret avec icône "?" - hover ou focus pour afficher la bulle.
	// Pure CSS (groupe hover), pas de JS, accessible (aria-describedby).
	// Usage : <Tooltip text="explication courte" />
	// Position : 'top' (default) ou 'bottom' selon proximité du haut de viewport.

	interface Props {
		text:     string
		position?: 'top' | 'bottom' | 'right'
		size?:    'sm' | 'md'           // sm = compact (à côté d'un label), md = standalone
		variant?: 'info' | 'tip' | 'warn' // info=cyan, tip=indigo, warn=amber
	}

	let { text, position = 'top', size = 'sm', variant = 'info' }: Props = $props()

	const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'

	const colors =
		variant === 'tip'  ? 'text-indigo-400 hover:text-indigo-300' :
		variant === 'warn' ? 'text-amber-400  hover:text-amber-300'  :
		                     'text-slate-500  hover:text-cyan-400'

	const bubbleColors =
		variant === 'tip'  ? 'border-indigo-500/40 bg-indigo-950/95 text-indigo-100' :
		variant === 'warn' ? 'border-amber-500/40  bg-amber-950/95  text-amber-100'  :
		                     'border-slate-700    bg-slate-950/95  text-slate-200'

	// Tailwind nécessite que les classes soient en clair dans le HTML pour purger,
	// donc on évite l'interpolation et on switch en dur sur les 3 positions.
</script>

<span class="relative inline-flex group align-middle">
	<button type="button" tabindex="0" aria-label={text}
		class="inline-flex items-center justify-center {iconSize} rounded-full transition-colors {colors} focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/60">
		<svg class="w-full h-full" fill="currentColor" viewBox="0 0 20 20">
			<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2h-1V10a1 1 0 00-1-1z" clip-rule="evenodd"/>
		</svg>
	</button>

	{#if position === 'top'}
		<span role="tooltip" class="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-xs px-2.5 py-1.5 rounded-md border text-[11px] leading-snug shadow-xl z-50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 {bubbleColors}">
			{text}
		</span>
	{:else if position === 'bottom'}
		<span role="tooltip" class="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 w-max max-w-xs px-2.5 py-1.5 rounded-md border text-[11px] leading-snug shadow-xl z-50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 {bubbleColors}">
			{text}
		</span>
	{:else}
		<span role="tooltip" class="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 w-max max-w-xs px-2.5 py-1.5 rounded-md border text-[11px] leading-snug shadow-xl z-50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 {bubbleColors}">
			{text}
		</span>
	{/if}
</span>
