<script lang="ts">
	import { onMount } from 'svelte'
	import { fly, fade } from 'svelte/transition'

	// Scripted, looping chat scenario. A single RAF loop drives the scenario
	// clock, types out each message character-by-character, and triggers
	// reactions / typing indicators on schedule.

	type Reaction = 'heart' | 'fire' | 'rocket'

	const ICONS: Record<Reaction, string> = {
		heart:  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
		fire:   'M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8c0-5.39-2.59-10.21-6.5-13.33zM12 20c-1.66 0-3-1.34-3-3 0-1.39.84-2.62 2.5-3.05 1.83-.5 2.7-1.5 3.13-2.65 2.06 1.25 3.37 3.41 3.37 5.7 0 1.66-1.34 3-3 3z',
		rocket: 'M12 2.5s4 1.5 4 8c0 3-2 5-2 5h-4s-2-2-2-5c0-6.5 4-8 4-8zm0 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm-5 6l-3 3c-.5.5-.5 1.3 0 1.8.3.3.6.4 1 .4.3 0 .6-.1.9-.4l2-2c-.4-.9-.7-1.8-.9-2.8zm10 0c-.2 1-.5 1.9-.9 2.8l2 2c.2.3.5.4.9.4.3 0 .7-.1.9-.4.5-.5.5-1.3 0-1.8l-3-3zM10 17.5h4l-1 3-.5 2-.5-2-2-3z',
	}

	interface Author {
		id:       string
		name:     string
		initials: string
		from:     string  // gradient stop 1
		to:       string  // gradient stop 2
	}

	const AUTHORS: Record<string, Author> = {
		alice:   { id: 'alice',   name: 'alice',   initials: 'AL', from: '#6366f1', to: '#8b5cf6' },
		bob:     { id: 'bob',     name: 'bob',     initials: 'BO', from: '#06b6d4', to: '#0ea5e9' },
		charlie: { id: 'charlie', name: 'charlie', initials: 'CH', from: '#ec4899', to: '#f97316' },
	}

	type Event =
		| { t: number; kind: 'typing';  author: string }
		| { t: number; kind: 'message'; author: string; text: string }
		| { t: number; kind: 'system';  text: string }
		| { t: number; kind: 'react';   target: number; by: string; reaction: Reaction }

	// Indices in the message stream are derived from how many 'message' / 'system'
	// events have fired before — so we reference them by zero-based position.
	const SCENARIO: Event[] = [
		{ t: 0.4,  kind: 'typing',  author: 'alice' },
		{ t: 2.0,  kind: 'message', author: 'alice', text: 'Pushed the new homepage widget on /widgets' },
		{ t: 3.6,  kind: 'react',   target: 0, by: 'bob',     reaction: 'fire' },
		{ t: 4.5,  kind: 'typing',  author: 'bob' },
		{ t: 5.8,  kind: 'message', author: 'bob',   text: 'Slick. Drop the link?' },
		{ t: 6.6,  kind: 'system',  text: 'charlie joined #widgets-dev' },
		{ t: 7.8,  kind: 'typing',  author: 'alice' },
		{ t: 9.4,  kind: 'message', author: 'alice', text: '/widgets/community-pulse-v2.zip' },
		{ t: 10.6, kind: 'react',   target: 3, by: 'charlie', reaction: 'rocket' },
		{ t: 11.2, kind: 'react',   target: 3, by: 'bob',     reaction: 'heart' },
		{ t: 12.0, kind: 'typing',  author: 'charlie' },
		{ t: 13.6, kind: 'message', author: 'charlie', text: 'Installed. P2P sync is instant on my Pi.' },
		{ t: 15.0, kind: 'react',   target: 4, by: 'alice',   reaction: 'fire' },
	]

	const SCENARIO_END = 17.0
	const RESET_PAUSE  = 3.0
	const CHAR_MS      = 32  // typing speed per character

	interface Msg {
		id:       number
		kind:     'msg' | 'system'
		author?:  string
		text:     string
		typed:    number
		typingStartedAt: number
		reactions: Array<{ reaction: Reaction; by: string; at: number; key: number }>
	}

	let elapsed       = $state(0)
	let messages      = $state<Msg[]>([])
	let typingAuthor  = $state<string | null>(null)
	let rttMs         = $state(3.2)

	// P2P "telemetry" — slight RTT jitter to feel live
	let _telTick = 0

	onMount(() => {
		let start = performance.now()
		let raf: number | null = null
		const fired = new Set<number>()

		function reset() {
			messages = []
			typingAuthor = null
			fired.clear()
			start = performance.now()
		}

		function fire(idx: number, e: Event) {
			fired.add(idx)
			const messageIdsSoFar = messages.filter(m => m.kind === 'msg' || m.kind === 'system').length

			switch (e.kind) {
				case 'typing':
					typingAuthor = e.author
					return
				case 'message':
					typingAuthor = null
					messages = [...messages, {
						id:    messageIdsSoFar,
						kind:  'msg',
						author: e.author,
						text:   e.text,
						typed:  0,
						typingStartedAt: performance.now(),
						reactions: [],
					}]
					return
				case 'system':
					messages = [...messages, {
						id:    messageIdsSoFar,
						kind:  'system',
						text:   e.text,
						typed:  e.text.length,
						typingStartedAt: performance.now(),
						reactions: [],
					}]
					return
				case 'react':
					messages = messages.map(m => {
						if (m.id !== e.target) return m
						return {
							...m,
							reactions: [...m.reactions, {
								reaction: e.reaction,
								by:       e.by,
								at:       performance.now(),
								key:      Math.random(),
							}],
						}
					})
					return
			}
		}

		function tick(now: number) {
			const t = (now - start) / 1000
			elapsed = t

			if (t > SCENARIO_END + RESET_PAUSE) {
				reset()
				raf = requestAnimationFrame(tick)
				return
			}

			// Fire scenario events
			for (let i = 0; i < SCENARIO.length; i++) {
				if (fired.has(i)) continue
				if (SCENARIO[i].t > t) continue
				fire(i, SCENARIO[i])
			}

			// Advance typed-out characters per message
			let dirty = false
			const nextMessages = messages.map(m => {
				if (m.kind !== 'msg') return m
				if (m.typed >= m.text.length) return m
				const sinceStart = now - m.typingStartedAt
				const target = Math.min(m.text.length, Math.floor(sinceStart / CHAR_MS))
				if (target !== m.typed) { dirty = true; return { ...m, typed: target } }
				return m
			})
			if (dirty) messages = nextMessages

			// RTT jitter — small flicker every ~300ms
			_telTick++
			if (_telTick % 18 === 0) {
				rttMs = 2.4 + Math.random() * 2.6
			}

			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)

		return () => { if (raf !== null) cancelAnimationFrame(raf) }
	})

	// Group reactions by type for compact display
	function groupReactions(rs: Msg['reactions']) {
		const map = new Map<Reaction, { count: number; latestAt: number; latestKey: number }>()
		for (const r of rs) {
			const cur = map.get(r.reaction)
			if (!cur) map.set(r.reaction, { count: 1, latestAt: r.at, latestKey: r.key })
			else      map.set(r.reaction, { count: cur.count + 1, latestAt: r.at, latestKey: r.key })
		}
		return Array.from(map.entries()).map(([k, v]) => ({ reaction: k, ...v }))
	}

	function authorOf(id?: string): Author | null {
		if (!id) return null
		return AUTHORS[id] ?? null
	}
</script>

<div class="chat">
	<!-- Header -->
	<div class="head">
		<div class="channel">
			<svg class="hash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 9h14M5 15h14M10 3L8 21M16 3l-2 18"/></svg>
			<span class="ch-name">widgets-dev</span>
			<span class="ch-meta">3 members</span>
		</div>
		<div class="telemetry">
			<span class="p2p-pill">
				<span class="pulse-dot"></span>
				<span class="p2p-label">P2P · 3 peers · {rttMs.toFixed(1)} ms RTT</span>
			</span>
		</div>
	</div>

	<!-- Messages -->
	<div class="stream">
		{#each messages as msg (msg.id)}
			{#if msg.kind === 'system'}
				<div class="sys-row" in:fade={{ duration: 220 }}>
					<div class="sys-line"></div>
					<span class="sys-text">{msg.text}</span>
					<div class="sys-line"></div>
				</div>
			{:else}
				{@const a = authorOf(msg.author)}
				<div class="msg-row" in:fly={{ y: 10, duration: 280 }}>
					{#if a}
						<div class="avatar" style="background: linear-gradient(135deg, {a.from} 0%, {a.to} 100%)">{a.initials}</div>
					{/if}
					<div class="bubble-col">
						<div class="meta">
							<span class="m-author" style="color: {a?.from ?? '#cbd5e1'}">{a?.name ?? ''}</span>
							<span class="m-time">now</span>
						</div>
						<div class="m-text">{msg.text.slice(0, msg.typed)}{#if msg.typed < msg.text.length}<span class="caret"></span>{/if}</div>
						{#if msg.reactions.length > 0}
							<div class="reactions">
								{#each groupReactions(msg.reactions) as r (r.reaction)}
									<span class="rxn" data-r={r.reaction}>
										<svg viewBox="0 0 24 24" class="rxn-icon"><path d={ICONS[r.reaction]} fill="currentColor"/></svg>
										<span class="rxn-count">{r.count}</span>
									</span>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/if}
		{/each}

		{#if typingAuthor}
			{@const a = authorOf(typingAuthor)}
			{#if a}
				<div class="msg-row typing-row">
					<div class="avatar avatar-dim" style="background: linear-gradient(135deg, {a.from} 0%, {a.to} 100%)">{a.initials}</div>
					<div class="bubble-col">
						<div class="meta">
							<span class="m-author" style="color: {a.from}">{a.name}</span>
							<span class="m-time">typing…</span>
						</div>
						<div class="typing-dots">
							<span></span><span></span><span></span>
						</div>
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.chat {
		max-width: 720px;
		margin: 0 auto;
		border-radius: 14px;
		overflow: hidden;
		background: linear-gradient(160deg, rgba(15,23,42,0.85) 0%, rgba(3,20,39,0.92) 100%);
		border: 1px solid rgba(255,255,255,0.08);
		box-shadow: 0 30px 60px -28px rgba(0,0,0,0.6), 0 0 80px -30px rgba(6,182,212,0.25);
		font-family: 'Geist', system-ui, sans-serif;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 18px;
		border-bottom: 1px solid rgba(255,255,255,0.06);
		background: rgba(15,23,42,0.5);
	}
	.channel {
		display: flex; align-items: center; gap: 10px;
		color: #c6c6cd;
	}
	.hash {
		width: 18px; height: 18px;
		color: #06b6d4;
	}
	.ch-name { font-weight: 600; color: #d3e4fe; font-size: 14px; }
	.ch-meta { font-size: 11px; color: #909097; }

	.telemetry { font-size: 11px; }
	.p2p-pill {
		display: inline-flex; align-items: center; gap: 8px;
		padding: 4px 10px;
		border-radius: 100px;
		background: rgba(6,182,212,0.08);
		border: 1px solid rgba(6,182,212,0.28);
		color: #4cd7f6;
		font-variant-numeric: tabular-nums;
	}
	.pulse-dot {
		width: 6px; height: 6px;
		border-radius: 50%;
		background: #06b6d4;
		box-shadow: 0 0 8px #06b6d4;
		animation: p2p-pulse 1.6s ease-in-out infinite;
	}
	.p2p-label { letter-spacing: 0.02em; }
	@keyframes p2p-pulse {
		0%, 100% { opacity: 1;    box-shadow: 0 0 8px  #06b6d4; }
		50%      { opacity: 0.55; box-shadow: 0 0 14px #06b6d4; }
	}

	.stream {
		padding: 18px 18px 22px;
		min-height: 420px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.msg-row {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}
	.avatar {
		flex-shrink: 0;
		width: 36px; height: 36px;
		border-radius: 50%;
		color: #fff;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		display: flex; align-items: center; justify-content: center;
		box-shadow: 0 4px 14px -6px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.2);
	}
	.avatar-dim { opacity: 0.55; }

	.bubble-col { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
	.meta {
		display: flex; align-items: baseline; gap: 8px;
		font-size: 12px;
	}
	.m-author { font-weight: 600; }
	.m-time   { color: #64748b; font-size: 11px; }

	.m-text {
		font-size: 14px;
		color: #d3e4fe;
		line-height: 1.55;
		word-break: break-word;
	}
	.caret {
		display: inline-block;
		width: 2px; height: 14px;
		background: #4cd7f6;
		vertical-align: -2px;
		margin-left: 1px;
		animation: caret-blink 1s steps(2) infinite;
	}
	@keyframes caret-blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }

	.reactions { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
	.rxn {
		display: inline-flex; align-items: center; gap: 5px;
		padding: 3px 8px;
		border-radius: 100px;
		background: rgba(15,23,42,0.6);
		border: 1px solid rgba(255,255,255,0.08);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: #c6c6cd;
		animation: rxn-pop 380ms cubic-bezier(0.16, 1.4, 0.3, 1);
	}
	.rxn[data-r="heart"]  { color: #f0abfc; background: rgba(236,72,153,0.10); border-color: rgba(236,72,153,0.30); }
	.rxn[data-r="fire"]   { color: #fb923c; background: rgba(251,146,60,0.10); border-color: rgba(251,146,60,0.30); }
	.rxn[data-r="rocket"] { color: #4cd7f6; background: rgba(6,182,212,0.10);   border-color: rgba(6,182,212,0.30); }
	.rxn-icon  { width: 12px; height: 12px; }
	.rxn-count { font-weight: 600; }
	@keyframes rxn-pop {
		0%   { transform: scale(0);   opacity: 0; }
		60%  { transform: scale(1.18); opacity: 1; }
		100% { transform: scale(1);    opacity: 1; }
	}

	.sys-row {
		display: flex; align-items: center; gap: 12px;
		padding: 4px 0;
		color: #64748b;
	}
	.sys-line { flex: 1; height: 1px; background: rgba(255,255,255,0.06); }
	.sys-text { font-size: 11px; letter-spacing: 0.02em; }

	.typing-row { opacity: 0.85; }
	.typing-dots {
		display: inline-flex; gap: 4px;
		padding: 8px 12px;
		border-radius: 100px;
		background: rgba(15,23,42,0.6);
		border: 1px solid rgba(255,255,255,0.06);
		width: max-content;
	}
	.typing-dots span {
		width: 5px; height: 5px;
		border-radius: 50%;
		background: #4cd7f6;
		animation: typing-bounce 1.1s ease-in-out infinite;
	}
	.typing-dots span:nth-child(2) { animation-delay: 0.16s; }
	.typing-dots span:nth-child(3) { animation-delay: 0.32s; }
	@keyframes typing-bounce {
		0%, 80%, 100% { transform: translateY(0);   opacity: 0.5; }
		40%           { transform: translateY(-3px); opacity: 1;   }
	}

	@media (max-width: 560px) {
		.head     { padding: 10px 12px; flex-wrap: wrap; gap: 6px; }
		.stream   { padding: 14px 12px; min-height: 460px; }
		.p2p-label { font-size: 10px; }
	}
</style>
