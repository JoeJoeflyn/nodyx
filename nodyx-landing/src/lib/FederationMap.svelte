<script lang="ts">
	import { onMount } from 'svelte'

	// Federation map: a constellation of Nodyx instances connected via the
	// Gossip Protocol. Cyan particles travel along the curved links, showing
	// events propagating across the network. Hover a node to focus its links.

	interface Node {
		id:    string
		label: string
		x:     number   // viewBox coords (0..1200)
		y:     number   // viewBox coords (0..600)
		hub?:  boolean
		icon:  string   // SVG path data (24x24 viewBox)
	}

	interface Link { from: string; to: string }

	const NODES: Node[] = [
		{ id: 'nodyx',   label: 'nodyx.org',         x: 600, y: 300, hub: true,
		  icon: 'M3 11a4 4 0 014-4h10a4 4 0 014 4v8H3v-8zm3 6h3M9 13h6M15 17h3' },
		{ id: 'studio',  label: 'studio.nodyx.org',  x: 250, y: 165,
		  icon: 'M4 8h3l2-3h6l2 3h3v11H4V8zm8 9.5a4 4 0 100-8 4 4 0 000 8z' },
		{ id: 'club',    label: 'club.nodyx.org',    x: 960, y: 165,
		  icon: 'M16 11a3 3 0 100-6 3 3 0 000 6zm-8 0a3 3 0 100-6 3 3 0 000 6zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.3 0-.62.02-.97.05A4.85 4.85 0 0117 16.5V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z' },
		{ id: 'art',     label: 'art.nodyx.org',     x: 340, y: 480,
		  icon: 'M12 2a10 10 0 100 20c1.1 0 2-.9 2-2v-1c0-1.1.9-2 2-2h2a4 4 0 004-4 10 10 0 00-10-11zm-5.5 9a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm3-4a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm5 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm3 4a1.5 1.5 0 110-3 1.5 1.5 0 010 3z' },
		{ id: 'radio',   label: 'radio.nodyx.org',   x: 860, y: 480,
		  icon: 'M2 12a10 10 0 0120 0M5.5 12a6.5 6.5 0 0113 0M9 12a3 3 0 016 0M11 12a1 1 0 012 0' },
		{ id: 'gaming',  label: 'gaming.nodyx.org',  x: 130, y: 360,
		  icon: 'M21 6H3a2 2 0 00-2 2v8a2 2 0 002 2h18a2 2 0 002-2V8a2 2 0 00-2-2zM7 14H5v-2H3v-2h2V8h2v2h2v2H7v2zm9 0a1 1 0 110-2 1 1 0 010 2zm3-3a1 1 0 110-2 1 1 0 010 2z' },
		{ id: 'code',    label: 'code.nodyx.org',    x: 1075, y: 340,
		  icon: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z' },
		{ id: 'dev',     label: 'dev.nodyx.org',     x: 600, y: 70,
		  icon: 'M19.4 12.9c0-.3 0-.6.1-.9l2-1.6a.5.5 0 00.1-.6l-2-3.4a.5.5 0 00-.6-.2l-2.4 1a7.2 7.2 0 00-1.6-.9l-.4-2.5a.5.5 0 00-.5-.4h-4a.5.5 0 00-.5.4l-.4 2.5c-.6.2-1.1.5-1.6.9l-2.4-1a.5.5 0 00-.6.2l-2 3.4a.5.5 0 00.1.6l2 1.6c0 .3-.1.6-.1.9s0 .6.1.9l-2 1.6a.5.5 0 00-.1.6l2 3.4c.1.2.4.3.6.2l2.4-1c.5.4 1 .7 1.6.9l.4 2.5c0 .2.3.4.5.4h4c.2 0 .5-.2.5-.4l.4-2.5c.6-.2 1.1-.5 1.6-.9l2.4 1c.2.1.5 0 .6-.2l2-3.4a.5.5 0 00-.1-.6l-2-1.6c.1-.3.1-.6.1-.9zM12 16a4 4 0 110-8 4 4 0 010 8z' },
	]

	const LINKS: Link[] = [
		// Hub-spoke
		{ from: 'nodyx', to: 'studio'  },
		{ from: 'nodyx', to: 'club'    },
		{ from: 'nodyx', to: 'radio'   },
		{ from: 'nodyx', to: 'art'     },
		{ from: 'nodyx', to: 'gaming'  },
		{ from: 'nodyx', to: 'code'    },
		{ from: 'nodyx', to: 'dev'     },
		// Peer-to-peer cross-links
		{ from: 'studio', to: 'dev'    },
		{ from: 'club',   to: 'dev'    },
		{ from: 'studio', to: 'gaming' },
		{ from: 'club',   to: 'code'   },
		{ from: 'art',    to: 'gaming' },
		{ from: 'radio',  to: 'code'   },
		{ from: 'art',    to: 'radio'  },
	]

	const byId = Object.fromEntries(NODES.map(n => [n.id, n]))

	// Build a curved bezier path between two nodes. The perpendicular offset
	// of the control point alternates to give the network a natural feel.
	function curveD(a: Node, b: Node, sign: number): string {
		const mx = (a.x + b.x) / 2
		const my = (a.y + b.y) / 2
		const dx = b.x - a.x
		const dy = b.y - a.y
		const len = Math.hypot(dx, dy)
		const offset = Math.min(80, len * 0.18) * sign
		const px = mx + (-dy / len) * offset
		const py = my + ( dx / len) * offset
		return `M${a.x} ${a.y} Q${px} ${py} ${b.x} ${b.y}`
	}

	const LINK_PATHS = LINKS.map((l, i) => {
		const a = byId[l.from]
		const b = byId[l.to]
		const sign = i % 2 === 0 ? 1 : -1
		return { ...l, d: curveD(a, b, sign) }
	})

	// Particles travelling along the links
	interface Particle {
		linkIdx: number
		t:       number
		speed:   number
		x:       number
		y:       number
	}

	let particles = $state<Particle[]>([])
	let pathEls: SVGPathElement[] = []
	let hovered = $state<string | null>(null)

	function isActiveLink(l: Link): boolean {
		if (!hovered) return true
		return l.from === hovered || l.to === hovered
	}

	onMount(() => {
		// Cache total length per path for O(1) point lookups
		const totalLengths = pathEls.map(p => p?.getTotalLength() ?? 1)

		// Seed initial particles, staggered across links
		const seed: Particle[] = []
		for (let i = 0; i < 14; i++) {
			seed.push({
				linkIdx: i % LINKS.length,
				t:       Math.random(),
				speed:   0.0018 + Math.random() * 0.0024,  // 0.0018..0.0042 of path / frame
				x:       0,
				y:       0,
			})
		}
		particles = seed

		let raf: number | null = null
		function tick() {
			// Functional-update would lose the inline pos mutation cost; we mutate in place
			// and reassign at the end to trigger the reactive re-render once per frame.
			const next: Particle[] = []
			for (const p of particles) {
				let t = p.t + p.speed
				let linkIdx = p.linkIdx
				if (t >= 1) {
					t = 0
					linkIdx = Math.floor(Math.random() * LINKS.length)
				}
				const path = pathEls[linkIdx]
				if (!path) {
					next.push({ ...p, t })
					continue
				}
				const len = totalLengths[linkIdx] ||  path.getTotalLength()
				totalLengths[linkIdx] = len
				const pt = path.getPointAtLength(len * t)
				next.push({ linkIdx, t, speed: p.speed, x: pt.x, y: pt.y })
			}
			particles = next
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)

		return () => { if (raf !== null) cancelAnimationFrame(raf) }
	})
</script>

<div class="fed-wrap">
	<svg viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid meet" class="fed-svg" aria-label="Nodyx federation network">
		<defs>
			<!-- Node body gradient -->
			<radialGradient id="nodeFill" cx="50%" cy="50%" r="50%">
				<stop offset="0%"   stop-color="#0b1c30"/>
				<stop offset="100%" stop-color="#031427"/>
			</radialGradient>
			<radialGradient id="hubFill" cx="50%" cy="50%" r="50%">
				<stop offset="0%"   stop-color="#1b2b3f"/>
				<stop offset="100%" stop-color="#031427"/>
			</radialGradient>
			<!-- Link gradient -->
			<linearGradient id="linkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
				<stop offset="0%"   stop-color="#06b6d4" stop-opacity="0.08"/>
				<stop offset="50%"  stop-color="#06b6d4" stop-opacity="0.45"/>
				<stop offset="100%" stop-color="#06b6d4" stop-opacity="0.08"/>
			</linearGradient>
			<!-- Particle glow filter -->
			<filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
				<feGaussianBlur stdDeviation="2.4" result="b"/>
				<feMerge>
					<feMergeNode in="b"/>
					<feMergeNode in="SourceGraphic"/>
				</feMerge>
			</filter>
			<!-- Node halo filter -->
			<filter id="halo" x="-50%" y="-50%" width="200%" height="200%">
				<feGaussianBlur stdDeviation="6"/>
			</filter>
		</defs>

		<!-- Links -->
		<g class="links" stroke="url(#linkGrad)" stroke-width="1.3" fill="none">
			{#each LINK_PATHS as l, i}
				<path
					bind:this={pathEls[i]}
					d={l.d}
					class:dimmed={!isActiveLink(l)}
				/>
			{/each}
		</g>

		<!-- Particles -->
		<g class="particles" filter="url(#glow)">
			{#each particles as p (`${p.linkIdx}-${p.speed}`)}
				<circle cx={p.x} cy={p.y} r="3.2" fill="#4cd7f6" opacity={isActiveLink(LINKS[p.linkIdx]) ? 0.95 : 0.25}/>
			{/each}
		</g>

		<!-- Nodes -->
		<g class="nodes">
			{#each NODES as n}
				{@const active = !hovered || hovered === n.id}
				<g class="node" class:hub={n.hub} class:dimmed={!active}
					transform="translate({n.x} {n.y})"
					onpointerenter={() => hovered = n.id}
					onpointerleave={() => hovered = null}
					role="img" aria-label={n.label}>
					<!-- Halo -->
					<circle r={n.hub ? 44 : 32} fill="#06b6d4" opacity={n.hub ? 0.22 : 0.14} filter="url(#halo)"/>
					{#if n.hub}
						<circle r="38" fill="none" stroke="#4cd7f6" stroke-width="1" stroke-opacity="0.35" class="hub-ring"/>
					{/if}
					<!-- Body -->
					<circle r={n.hub ? 30 : 22} fill={n.hub ? 'url(#hubFill)' : 'url(#nodeFill)'}
						stroke="#06b6d4" stroke-width={n.hub ? 1.4 : 1} stroke-opacity={n.hub ? 0.9 : 0.6}/>
					<!-- Icon -->
					<g transform={n.hub ? 'translate(-11 -11) scale(0.92)' : 'translate(-8 -8) scale(0.68)'}>
						<path d={n.icon} fill="none" stroke="#a5b4fc" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
					</g>
					<!-- Label -->
					<text y={n.hub ? 56 : 44} text-anchor="middle" class="lbl" class:hub={n.hub}>{n.label}</text>
				</g>
			{/each}
		</g>
	</svg>
</div>

<style>
	.fed-wrap {
		position: relative;
		width: 100%;
		max-width: 1200px;
		margin: 0 auto;
		aspect-ratio: 1200 / 600;
	}
	.fed-svg {
		width: 100%;
		height: 100%;
		display: block;
		overflow: visible;
	}

	.links path {
		transition: opacity 240ms ease, stroke-width 240ms ease;
	}
	.links path.dimmed { opacity: 0.18; }

	.node {
		cursor: pointer;
		transition: opacity 240ms ease, transform 220ms ease;
		transform-box: fill-box;
	}
	.node.dimmed { opacity: 0.32; }
	.node:hover { filter: drop-shadow(0 0 12px rgba(76, 215, 246, 0.45)); }

	.lbl {
		font-family: 'Geist Mono', ui-monospace, monospace;
		font-size: 13px;
		fill: #c6c6cd;
		letter-spacing: 0.01em;
	}
	.lbl.hub {
		fill: #4cd7f6;
		font-weight: 600;
		font-size: 14px;
	}

	.hub-ring {
		transform-origin: center;
		animation: hub-pulse 3.2s ease-in-out infinite;
	}
	@keyframes hub-pulse {
		0%, 100% { stroke-opacity: 0.18; transform: scale(1);    }
		50%      { stroke-opacity: 0.55; transform: scale(1.08); }
	}

	@media (max-width: 720px) {
		.lbl    { font-size: 18px; }
		.lbl.hub { font-size: 20px; }
	}
</style>
