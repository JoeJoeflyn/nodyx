<!--
  Rend du texte brut avec linkify + warning anti-phishing.
  Chaque URL devient un <a> qui, au click, intercepte la navigation et passe
  par le modal ExternalLinkWarning (sauf si liens internes Nodyx).

  Pas de {@html}, pas de innerHTML, pas de string concat HTML. Tout en
  composants Svelte natifs → XSS-safe par construction.
-->
<script lang="ts">
	import { linkify } from '$lib/linkify'
	import { requestOpenExternal } from '$lib/stores/externalLinkGuard'
	import { analyzeUrl } from '$lib/urlAnalysis'

	interface Props {
		text: string
	}

	let { text }: Props = $props()

	const segments = $derived(linkify(text))

	function onLinkClick(e: MouseEvent, url: string) {
		const analysis = analyzeUrl(url)
		// Liens internes : navigation native (target=_blank pour ouvrir en
		// nouvel onglet, mais pas de modal de warning, c'est notre domaine).
		if (analysis.isInternal) return
		// Externe : on bloque la navigation et on demande confirmation.
		e.preventDefault()
		requestOpenExternal(url)
	}
</script>

<span class="message-body">
	{#each segments as seg, i (i)}
		{#if seg.type === 'text'}
			{seg.value}
		{:else if seg.type === 'mention'}
			<a href={`/users/${seg.username}`} class="message-body__mention">{seg.value}</a>
		{:else if seg.type === 'url'}
			<a
				href={seg.href}
				target="_blank"
				rel="noopener noreferrer nofollow"
				class="message-body__link"
				onclick={(e) => onLinkClick(e, seg.href)}
			>{seg.value}</a>
		{/if}
	{/each}
</span>

<style>
	.message-body {
		white-space: pre-wrap;
		word-break: break-word;
	}
	.message-body__link {
		color: #93c5fd;
		text-decoration: underline;
		text-decoration-color: rgba(147, 197, 253, 0.4);
		text-underline-offset: 2px;
		transition: color .15s, text-decoration-color .15s;
		word-break: break-all;
	}
	.message-body__link:hover {
		color: #bfdbfe;
		text-decoration-color: rgba(191, 219, 254, 0.85);
	}
	.message-body__mention {
		color: #c4b5fd;
		font-weight: 600;
		text-decoration: none;
		padding: 0 2px;
		border-radius: 3px;
		transition: background .15s;
	}
	.message-body__mention:hover {
		background: rgba(196, 181, 253, 0.12);
	}
</style>
