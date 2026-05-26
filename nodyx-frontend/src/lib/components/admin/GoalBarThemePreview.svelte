<script lang="ts">
	// Mini-preview d'un thème de goal bar pour le picker. Reprend les
	// mêmes CSS que la page overlay /overlay/goal/[token] à échelle 0.8.

	type GoalTheme = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
	type CustomTheme = {
		bgColor?:    string | null
		textColor?:  string | null
		barBgColor?: string | null
	}

	interface Props {
		theme:        GoalTheme
		accent?:      string
		customTheme?: CustomTheme
	}

	let { theme, accent = '#06b6d4', customTheme }: Props = $props()

	function safeCssValue(s: string | null | undefined): string {
		if (!s) return ''
		return s.replace(/[\\;}{"`]/g, '').slice(0, 200)
	}

	const customStyle = $derived(
		theme === 'custom' && customTheme
			? [
				customTheme.bgColor    ? `--card-bg: ${safeCssValue(customTheme.bgColor)}` : '',
				customTheme.textColor  ? `--text-color: ${safeCssValue(customTheme.textColor)}` : '',
				customTheme.barBgColor ? `--bar-bg: ${safeCssValue(customTheme.barBgColor)}` : '',
			].filter(Boolean).join('; ')
			: '',
	)
</script>

<div class="preview-wrap">
	<div class="preview-scale">
		<div class="card theme-{theme}" style="--accent: {accent}; {customStyle}">
			<div class="label-row">
				<span class="label">Objectif</span>
				<span class="counter">
					<span class="current">42</span>
					<span class="sep">/</span>
					<span class="target">100</span>
				</span>
			</div>
			<div class="bar">
				<div class="bar-fill" style="width: 42%; background: linear-gradient(90deg, {accent}, color-mix(in oklab, {accent} 70%, white));"></div>
			</div>
		</div>
	</div>
</div>

<style>
	.preview-wrap {
		position: relative;
		width: 100%;
		height: 110px;
		overflow: hidden;
		border-radius: 6px;
		background:
			linear-gradient(45deg, #0a0a14 25%, transparent 25%),
			linear-gradient(-45deg, #0a0a14 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #0a0a14 75%),
			linear-gradient(-45deg, transparent 75%, #0a0a14 75%);
		background-size: 14px 14px;
		background-position: 0 0, 0 7px, 7px -7px, -7px 0;
		background-color: #1a1a2e;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 8px;
	}
	.preview-scale {
		transform: scale(0.8);
		transform-origin: center;
		width: 100%;
		max-width: 280px;
		font-family: 'Geist', -apple-system, system-ui, sans-serif;
	}

	/* ══ CSS commune (mirror de la vraie page overlay) ═════════════════ */

	.card {
		padding: 10px 14px;
		border-radius: 12px;
		--bar-bg:    rgba(255, 255, 255, 0.06);
		--text-color: #f1f5f9;
		--card-bg:   rgba(15, 23, 42, 0.88);
	}
	.label-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; gap: 12px; }
	.label   { font-size: 12px; font-weight: 600; color: var(--text-color); }
	.counter { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-color); opacity: 0.9; font-weight: 600; }
	.counter .current { color: var(--accent); opacity: 1; }
	.counter .sep     { color: var(--text-color); opacity: 0.4; margin: 0 2px; }
	.bar {
		position: relative; height: 10px;
		background: var(--bar-bg);
		border-radius: 999px; overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.04);
	}
	.bar-fill { height: 100%; border-radius: 999px;
		box-shadow: 0 0 10px color-mix(in oklab, var(--accent) 60%, transparent), inset 0 0 6px rgba(255, 255, 255, 0.15); }

	/* Cyber */
	.theme-cyber {
		background: rgba(15, 23, 42, 0.88);
		border: 1px solid color-mix(in oklab, var(--accent) 35%, transparent);
		box-shadow: 0 6px 20px color-mix(in oklab, var(--accent) 25%, transparent);
	}
	/* Soft */
	.theme-soft {
		--text-color: #1e293b;
		background: rgba(255, 255, 255, 0.95);
		border-radius: 20px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
	}
	.theme-soft .bar { --bar-bg: rgba(0, 0, 0, 0.08); }
	/* Retro */
	.theme-retro {
		font-family: 'VT323', monospace;
		background: #1a1a2e;
		border: 3px solid var(--accent);
		border-radius: 0;
		box-shadow: 5px 5px 0 0 color-mix(in oklab, var(--accent) 60%, black);
	}
	.theme-retro .label   { font-size: 16px; }
	.theme-retro .counter { font-size: 16px; font-family: 'VT323', monospace; }
	.theme-retro .bar     { border-radius: 0; height: 14px; --bar-bg: #0a0a14; }
	.theme-retro .bar-fill { border-radius: 0; }
	/* Neon */
	.theme-neon {
		background: #050511;
		border: 2px solid var(--accent);
		box-shadow: 0 0 14px var(--accent), 0 0 28px color-mix(in oklab, var(--accent) 60%, transparent);
	}
	.theme-neon .label { text-shadow: 0 0 6px var(--accent); }
	/* Minimal */
	.theme-minimal {
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 0;
	}
	.theme-minimal .label   { font-size: 16px; font-weight: 800; text-shadow: 0 2px 8px rgba(0,0,0,0.7); }
	.theme-minimal .counter { color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,0.7); }
	.theme-minimal .bar     { height: 6px; --bar-bg: rgba(255,255,255,0.15); border: none; }
	/* Custom */
	.theme-custom {
		background: var(--card-bg);
		border: 1px solid color-mix(in oklab, var(--accent) 30%, transparent);
		border-radius: 12px;
		box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
	}
</style>
