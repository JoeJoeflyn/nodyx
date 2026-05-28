// ─── Nodyx Sound Library — WebAudio synthesized presets ──────────────────────
// 6 sons d'alerte générés en pur WebAudio. Aucun fichier audio bundlé, donc
// zéro question de licence et zéro charge réseau. La synthèse est légère :
// quelques oscillateurs avec enveloppes ADSR rapides, le tout autorise 60+
// événements / seconde sans drop d'audio.
//
// API unifiée :
//   - URL classique (http://, /uploads/, blob:) → new Audio() + .play()
//   - Préfixe "nodyx:<preset>"                  → synthèse WebAudio
//
// Tous les players exposent .volume normalisé [0, 1] et .label humain.

export const PRESET_KEYS = ['chime', 'ding', 'pop', 'bell', 'retro', 'fanfare', 'none'] as const
export type PresetKey = typeof PRESET_KEYS[number]

export interface PresetMeta {
	key:   PresetKey
	label: string
	hint:  string
	emoji: string
}

export const PRESET_LIBRARY: readonly PresetMeta[] = [
	{ key: 'none',    label: 'Aucun',         hint: 'Pas de son joué',                            emoji: '🔇' },
	{ key: 'chime',   label: 'Carillon',      hint: 'Cloche douce, ambiance Zen',                 emoji: '🔔' },
	{ key: 'ding',    label: 'Ding',          hint: 'Court, neutre, parfait notification',        emoji: '🛎️' },
	{ key: 'pop',     label: 'Pop',           hint: 'Très bref, discret',                         emoji: '💧' },
	{ key: 'bell',    label: 'Cloche',        hint: 'Cloche métallique, accent fort',             emoji: '🎐' },
	{ key: 'retro',   label: 'Retro 8-bit',   hint: 'Arpège chiptune, vibe gaming',               emoji: '🎮' },
	{ key: 'fanfare', label: 'Fanfare',       hint: 'Triomphe court, sub / gros event',           emoji: '🎺' },
]

const PRESET_KEY_SET: ReadonlySet<string> = new Set(PRESET_KEYS)

export function isPresetUrl(url: string | null | undefined): url is `nodyx:${PresetKey}` {
	if (!url) return false
	if (!url.startsWith('nodyx:')) return false
	return PRESET_KEY_SET.has(url.slice(6))
}

export function presetUrl(key: PresetKey): `nodyx:${PresetKey}` {
	return `nodyx:${key}` as const
}

export function presetKeyOf(url: string): PresetKey | null {
	if (!url.startsWith('nodyx:')) return null
	const k = url.slice(6)
	return PRESET_KEY_SET.has(k) ? k as PresetKey : null
}

// ── WebAudio singleton ─────────────────────────────────────────────────────
// On garde un AudioContext partagé pour tous les sons. Création lazy (un user
// gesture peut être requis sur Safari pour .resume()).

type AudioCtor = typeof AudioContext
let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
	if (typeof window === 'undefined') return null
	if (ctx && ctx.state !== 'closed') return ctx
	const W = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }
	const Ctor = W.AudioContext ?? W.webkitAudioContext
	if (!Ctor) return null
	ctx = new Ctor()
	return ctx
}

// Resume sur premier user gesture (Safari, Chrome autoplay policy)
let resumePending = false
function tryResume(): void {
	const c = getCtx()
	if (!c || c.state === 'running' || resumePending) return
	resumePending = true
	c.resume().finally(() => { resumePending = false })
}

if (typeof window !== 'undefined') {
	const arm = (): void => { tryResume(); window.removeEventListener('pointerdown', arm); window.removeEventListener('keydown', arm) }
	window.addEventListener('pointerdown', arm, { once: true })
	window.addEventListener('keydown',     arm, { once: true })
}

// ── Helpers ────────────────────────────────────────────────────────────────

interface ToneOpts {
	freq:       number
	type?:      OscillatorType
	startTime:  number
	duration:   number       // sec
	attack?:    number       // sec
	release?:   number       // sec
	peakGain:   number       // 0..1, multiplied by master volume
	masterGain: GainNode
}

function playTone(c: AudioContext, opts: ToneOpts): void {
	const osc = c.createOscillator()
	const g   = c.createGain()
	osc.type      = opts.type ?? 'sine'
	osc.frequency.value = opts.freq
	const attack  = opts.attack  ?? 0.008
	const release = opts.release ?? Math.max(0.03, opts.duration * 0.7)
	const end     = opts.startTime + opts.duration

	g.gain.setValueAtTime(0, opts.startTime)
	g.gain.linearRampToValueAtTime(opts.peakGain, opts.startTime + attack)
	g.gain.exponentialRampToValueAtTime(0.0001, end + release)

	osc.connect(g)
	g.connect(opts.masterGain)
	osc.start(opts.startTime)
	osc.stop(end + release + 0.05)
}

// ── Players par preset ─────────────────────────────────────────────────────

function playChime(c: AudioContext, master: GainNode): void {
	const t = c.currentTime
	playTone(c, { freq: 880,  startTime: t,         duration: 0.45, peakGain: 0.35, masterGain: master })
	playTone(c, { freq: 1318, startTime: t + 0.10,  duration: 0.55, peakGain: 0.28, masterGain: master })
	playTone(c, { freq: 1760, startTime: t + 0.18,  duration: 0.65, peakGain: 0.22, masterGain: master })
}

function playDing(c: AudioContext, master: GainNode): void {
	const t = c.currentTime
	playTone(c, { freq: 1046, type: 'triangle', startTime: t,         duration: 0.12, peakGain: 0.45, masterGain: master })
	playTone(c, { freq: 1568, type: 'triangle', startTime: t + 0.06,  duration: 0.18, peakGain: 0.38, masterGain: master })
}

function playPop(c: AudioContext, master: GainNode): void {
	const t = c.currentTime
	playTone(c, { freq: 660, type: 'square', startTime: t, duration: 0.06, peakGain: 0.35, attack: 0.001, release: 0.01, masterGain: master })
	playTone(c, { freq: 990, type: 'sine',   startTime: t + 0.005, duration: 0.05, peakGain: 0.25, attack: 0.001, release: 0.01, masterGain: master })
}

function playBell(c: AudioContext, master: GainNode): void {
	const t = c.currentTime
	const fund = 622   // D#5, approx clochette
	// Harmoniques d'une cloche, gain inversement proportionnel
	const partials = [1, 2.4, 4.5, 5.4, 6.8]
	partials.forEach((p, i) => {
		playTone(c, {
			freq:      fund * p,
			type:      'sine',
			startTime: t,
			duration:  1.2 - i * 0.12,
			peakGain:  0.32 / (i + 1.4),
			attack:    0.005,
			release:   0.6,
			masterGain: master,
		})
	})
}

function playRetro(c: AudioContext, master: GainNode): void {
	const t = c.currentTime
	const seq = [523, 659, 784, 1046]  // C5 E5 G5 C6
	seq.forEach((f, i) => {
		playTone(c, {
			freq:      f,
			type:      'square',
			startTime: t + i * 0.07,
			duration:  0.075,
			peakGain:  0.28,
			attack:    0.001,
			release:   0.02,
			masterGain: master,
		})
	})
}

function playFanfare(c: AudioContext, master: GainNode): void {
	const t = c.currentTime
	// Triade montante + harmonique brillante
	const notes = [
		{ f: 523, off: 0.00, dur: 0.16 },
		{ f: 659, off: 0.10, dur: 0.16 },
		{ f: 784, off: 0.20, dur: 0.16 },
		{ f: 1046, off: 0.30, dur: 0.45 },
	]
	notes.forEach(n => {
		playTone(c, { freq: n.f,     type: 'triangle', startTime: t + n.off, duration: n.dur, peakGain: 0.38, masterGain: master })
		playTone(c, { freq: n.f * 2, type: 'sine',     startTime: t + n.off, duration: n.dur, peakGain: 0.10, masterGain: master })
	})
}

const PRESET_PLAYERS: Record<Exclude<PresetKey, 'none'>, (c: AudioContext, m: GainNode) => void> = {
	chime:   playChime,
	ding:    playDing,
	pop:     playPop,
	bell:    playBell,
	retro:   playRetro,
	fanfare: playFanfare,
}

// ── Public API ─────────────────────────────────────────────────────────────

export function playPreset(key: PresetKey, volume = 0.7): void {
	if (key === 'none') return
	const c = getCtx()
	if (!c) return
	tryResume()
	const master = c.createGain()
	master.gain.value = Math.min(1, Math.max(0, volume))
	master.connect(c.destination)
	PRESET_PLAYERS[key](c, master)
}

/**
 * Unified player : accepte URL classique OU "nodyx:<preset>". Best-effort,
 * swallow toutes les exceptions (autoplay block, format invalide).
 */
export function playAlertSound(soundUrl: string | null | undefined, volume = 0.7): void {
	if (!soundUrl) return
	const presetKey = presetKeyOf(soundUrl)
	if (presetKey) {
		playPreset(presetKey, volume)
		return
	}
	try {
		const a = new Audio(soundUrl)
		a.volume = Math.min(1, Math.max(0, volume))
		a.play().catch(() => { /* autoplay bloqué hors OBS */ })
	} catch { /* invalid url */ }
}
