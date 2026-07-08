/**
 * Tests de la bascule mesh↔SFU (socket/voiceBascule.ts) — machine à états serveur.
 *
 * Couvre : déclencheur au seuil, porte "tous prêts" (zéro coupure), abandon au
 * timeout, anti-flapping, remise à zéro, et surtout la DORMANCE (flag off ⇒ rien).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as bascule from '../socket/voiceBascule'

const CH = 'chan-1'

type Sock = { id: string }
function makeServer(initial: Sock[] = []) {
  const emits: { room: string; ev: string; payload: Record<string, unknown> }[] = []
  let current = initial
  const server = {
    to: (room: string) => ({
      emit: (ev: string, payload: Record<string, unknown>) => { emits.push({ room, ev, payload }) },
    }),
    in: (_room: string) => ({ fetchSockets: async () => current }),
  }
  return { server: server as never, emits, setSockets: (s: Sock[]) => { current = s } }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const evs = (emits: { ev: string }[]) => emits.map((e) => e.ev)

beforeEach(() => {
  process.env.VOICE_SFU_AUTO = 'true'
  process.env.VOICE_SFU_URL = 'http://127.0.0.1:3901'
  process.env.VOICE_SFU_AUTO_CHANNELS = ''
  process.env.VOICE_SFU_MESH_THRESHOLD = '3'
  bascule._resetAllForTest()
})
afterEach(() => { vi.useRealTimers() })

describe('déclencheur', () => {
  it('sous le seuil : reste mesh, aucune annonce', () => {
    const { server, emits } = makeServer()
    bascule.onSeatCount(server, CH, 2)
    expect(bascule.channelMode(CH)).toBe('mesh')
    expect(emits).toHaveLength(0)
  })

  it('au seuil : passe en switching et annonce voice:mode sfu', () => {
    const { server, emits } = makeServer()
    bascule.onSeatCount(server, CH, 3)
    expect(bascule.channelMode(CH)).toBe('switching')
    expect(emits).toHaveLength(1)
    expect(emits[0].ev).toBe('voice:mode')
    expect(emits[0].payload).toMatchObject({ channelId: CH, mode: 'sfu' })
  })
})

describe('porte "tous prêts" (zéro coupure)', () => {
  it('commit seulement quand TOUS les sockets sont prêts', async () => {
    const { server, emits } = makeServer([{ id: 's1' }, { id: 's2' }, { id: 's3' }])
    bascule.onSeatCount(server, CH, 3)

    bascule.onSfuReady(server, CH, 's1')
    bascule.onSfuReady(server, CH, 's2')
    await flush()
    expect(bascule.channelMode(CH)).toBe('switching')  // pas encore tous prêts
    expect(evs(emits)).not.toContain('voice:sfu_commit')

    bascule.onSfuReady(server, CH, 's3')
    await flush()
    expect(bascule.channelMode(CH)).toBe('sfu')
    expect(bascule.channelIsSfu(CH)).toBe(true)
    expect(evs(emits)).toContain('voice:sfu_commit')
  })

  it("un départ pendant switching débloque le commit s'il ne restait que lui", async () => {
    const srv = makeServer([{ id: 's1' }, { id: 's2' }, { id: 's3' }])
    bascule.onSeatCount(srv.server, CH, 3)
    bascule.onSfuReady(srv.server, CH, 's1')
    bascule.onSfuReady(srv.server, CH, 's2')
    await flush()
    expect(bascule.channelMode(CH)).toBe('switching')

    // s3 part : il ne reste que s1+s2, tous deux prêts → commit
    srv.setSockets([{ id: 's1' }, { id: 's2' }])
    bascule.onLeave(srv.server, CH, 's3', 2)
    await flush()
    expect(bascule.channelMode(CH)).toBe('sfu')
  })
})

describe('abandon (échec) + anti-flapping', () => {
  it('timeout ⇒ abandon vers mesh, puis pas de retry avant baisse sous le seuil', async () => {
    vi.useFakeTimers()
    const { server, emits } = makeServer([{ id: 's1' }, { id: 's2' }, { id: 's3' }])
    bascule.onSeatCount(server, CH, 3)
    expect(bascule.channelMode(CH)).toBe('switching')

    vi.advanceTimersByTime(9001) // personne n'a confirmé → abandon
    expect(bascule.channelMode(CH)).toBe('mesh')
    const abortEmit = emits.find((e) => e.ev === 'voice:mode' && e.payload.mode === 'mesh')
    expect(abortEmit).toBeDefined()

    // Anti-flapping : re-franchir le seuil ne relance PAS tant que la compo n'a pas changé
    const before = emits.length
    bascule.onSeatCount(server, CH, 3)
    expect(bascule.channelMode(CH)).toBe('mesh')
    expect(emits.length).toBe(before)

    // La compo baisse sous le seuil → le cooldown se lève
    bascule.onLeave(server, CH, 's3', 2)
    // Re-franchir : on retente
    bascule.onSeatCount(server, CH, 3)
    expect(bascule.channelMode(CH)).toBe('switching')
  })
})

describe('remise à zéro', () => {
  it('canal vidé (remaining 0) ⇒ retour à mesh', async () => {
    const { server } = makeServer([{ id: 's1' }, { id: 's2' }, { id: 's3' }])
    bascule.onSeatCount(server, CH, 3)
    bascule.onSfuReady(server, CH, 's1')
    bascule.onSfuReady(server, CH, 's2')
    bascule.onSfuReady(server, CH, 's3')
    await flush()
    expect(bascule.channelMode(CH)).toBe('sfu')

    bascule.onLeave(server, CH, 's1', 0)
    expect(bascule.channelMode(CH)).toBe('mesh')
  })
})

describe('dormance (doctrine additive)', () => {
  it('flag off ⇒ jamais de bascule, aucune annonce', () => {
    process.env.VOICE_SFU_AUTO = 'false'
    const { server, emits } = makeServer()
    bascule.onSeatCount(server, CH, 50)
    expect(bascule.channelMode(CH)).toBe('mesh')
    expect(emits).toHaveLength(0)
  })

  it('sans VOICE_SFU_URL ⇒ dormant', () => {
    delete process.env.VOICE_SFU_URL
    const { server, emits } = makeServer()
    bascule.onSeatCount(server, CH, 50)
    expect(bascule.channelMode(CH)).toBe('mesh')
    expect(emits).toHaveLength(0)
  })

  it('canal hors liste blanche ⇒ dormant, canal listé ⇒ actif', () => {
    process.env.VOICE_SFU_AUTO_CHANNELS = 'autre-canal'
    const a = makeServer()
    bascule.onSeatCount(a.server, CH, 5)
    expect(bascule.channelMode(CH)).toBe('mesh')  // CH pas dans la liste

    process.env.VOICE_SFU_AUTO_CHANNELS = `autre-canal,${CH}`
    const b = makeServer()
    bascule.onSeatCount(b.server, CH, 5)
    expect(bascule.channelMode(CH)).toBe('switching')  // CH listé → actif
  })
})
