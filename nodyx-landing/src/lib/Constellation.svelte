<script lang="ts">
	import { onMount } from 'svelte'

	// Constellation network canvas: full-screen, fixed, behind content.
	// Nodes drift slowly, draw lines between close neighbours, and react
	// to the pointer with a magnetic halo + cursor-to-node connections.

	let canvas: HTMLCanvasElement | undefined = $state()

	const NODE_COUNT      = 70
	const CONNECT_DIST    = 150
	const MOUSE_DIST      = 200
	const NODE_BASE_COLOR = '186, 230, 253'  // light cyan for the dots
	const LINE_COLOR      = '76, 215, 246'   // brighter cyan for connections

	interface Node { x: number; y: number; vx: number; vy: number; r: number }

	onMount(() => {
		if (!canvas) return
		const ctx = canvas.getContext('2d')
		if (!ctx) return

		let nodes: Node[] = []
		let mouseX = -9999, mouseY = -9999
		let W = window.innerWidth, H = window.innerHeight
		let dpr = Math.min(2, window.devicePixelRatio || 1)
		let raf: number | null = null
		let visible = true

		function resize() {
			W   = window.innerWidth
			H   = window.innerHeight
			dpr = Math.min(2, window.devicePixelRatio || 1)
			canvas!.width  = Math.floor(W * dpr)
			canvas!.height = Math.floor(H * dpr)
			canvas!.style.width  = W + 'px'
			canvas!.style.height = H + 'px'
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
		}

		function spawn() {
			nodes = []
			for (let i = 0; i < NODE_COUNT; i++) {
				nodes.push({
					x:  Math.random() * W,
					y:  Math.random() * H,
					vx: (Math.random() - 0.5) * 0.18,
					vy: (Math.random() - 0.5) * 0.18,
					r:  1.1 + Math.random() * 0.9,
				})
			}
		}

		function tick() {
			if (!visible) { raf = requestAnimationFrame(tick); return }
			ctx!.clearRect(0, 0, W, H)

			for (const n of nodes) {
				n.x += n.vx
				n.y += n.vy
				if (n.x < 0 || n.x > W) n.vx *= -1
				if (n.y < 0 || n.y > H) n.vy *= -1

				// Soft magnetic pull toward the pointer when close
				const mdx = mouseX - n.x, mdy = mouseY - n.y
				const md2 = mdx * mdx + mdy * mdy
				if (md2 < MOUSE_DIST * MOUSE_DIST) {
					const f = (1 - Math.sqrt(md2) / MOUSE_DIST) * 0.04
					n.x += mdx * f * 0.012
					n.y += mdy * f * 0.012
				}
			}

			// Node-to-node connections
			ctx!.lineWidth = 0.55
			for (let i = 0; i < nodes.length; i++) {
				const a = nodes[i]
				for (let j = i + 1; j < nodes.length; j++) {
					const b = nodes[j]
					const dx = a.x - b.x, dy = a.y - b.y
					const d2 = dx * dx + dy * dy
					if (d2 < CONNECT_DIST * CONNECT_DIST) {
						const d = Math.sqrt(d2)
						const alpha = (1 - d / CONNECT_DIST) * 0.32
						ctx!.strokeStyle = `rgba(${LINE_COLOR}, ${alpha})`
						ctx!.beginPath()
						ctx!.moveTo(a.x, a.y)
						ctx!.lineTo(b.x, b.y)
						ctx!.stroke()
					}
				}
			}

			// Cursor-to-node connections (brighter, single-source halo)
			ctx!.lineWidth = 0.7
			for (const n of nodes) {
				const dx = n.x - mouseX, dy = n.y - mouseY
				const d2 = dx * dx + dy * dy
				if (d2 < MOUSE_DIST * MOUSE_DIST) {
					const d     = Math.sqrt(d2)
					const alpha = (1 - d / MOUSE_DIST) * 0.55
					ctx!.strokeStyle = `rgba(${LINE_COLOR}, ${alpha})`
					ctx!.beginPath()
					ctx!.moveTo(n.x, n.y)
					ctx!.lineTo(mouseX, mouseY)
					ctx!.stroke()
				}
			}

			// Nodes (visible dots with subtle glow)
			for (const n of nodes) {
				const dx = n.x - mouseX, dy = n.y - mouseY
				const close = Math.sqrt(dx * dx + dy * dy) < MOUSE_DIST
				const r = close ? n.r + 0.9 : n.r
				// Soft outer halo
				ctx!.fillStyle = `rgba(${NODE_BASE_COLOR}, ${close ? 0.18 : 0.08})`
				ctx!.beginPath()
				ctx!.arc(n.x, n.y, r * 2.6, 0, Math.PI * 2)
				ctx!.fill()
				// Core dot
				ctx!.fillStyle = `rgba(${NODE_BASE_COLOR}, ${close ? 1 : 0.72})`
				ctx!.beginPath()
				ctx!.arc(n.x, n.y, r, 0, Math.PI * 2)
				ctx!.fill()
			}

			raf = requestAnimationFrame(tick)
		}

		resize()
		spawn()
		tick()

		const onResize  = () => { resize(); spawn() }
		const onMove    = (e: PointerEvent) => { mouseX = e.clientX; mouseY = e.clientY }
		const onLeave   = () => { mouseX = -9999; mouseY = -9999 }
		const onVisible = () => { visible = !document.hidden }

		window.addEventListener('resize', onResize)
		window.addEventListener('pointermove', onMove, { passive: true })
		window.addEventListener('pointerleave', onLeave)
		document.addEventListener('visibilitychange', onVisible)

		return () => {
			if (raf !== null) cancelAnimationFrame(raf)
			window.removeEventListener('resize', onResize)
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerleave', onLeave)
			document.removeEventListener('visibilitychange', onVisible)
		}
	})
</script>

<canvas bind:this={canvas} class="constellation" aria-hidden="true"></canvas>

<style>
	.constellation {
		position: fixed;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		/* Keep the canvas visible, just freeze the animation via the JS side */
		.constellation { opacity: 0.6; }
	}
</style>
