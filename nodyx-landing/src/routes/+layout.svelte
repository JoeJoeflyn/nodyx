<script lang="ts">
	import '../app.css'
	import Constellation from '$lib/Constellation.svelte'
	let { children } = $props()
</script>

<div class="cmd-bg"></div>
<Constellation />

{@render children()}
