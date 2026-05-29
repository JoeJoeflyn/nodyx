// ─── Spec 017 — couche config (settings DB ↔ process.env) ─────────────────────
// Garantit : overlay DB > .env, secrets jamais injectés en Phase 1, boot
// résilient (jamais bloquant), validation stricte, effet à chaud (process.env
// muté), restartRequired uniquement pour tier ≤ 2.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { dbQueryMock } = vi.hoisted(() => ({ dbQueryMock: vi.fn() }))

vi.mock('../config/database', () => ({
  db:    { query: dbQueryMock },
  redis: {},
}))

import { loadSettingsIntoEnv, setSettings, getEffectiveSettings } from '../config/settings'

const TOUCHED = [
  'NODYX_COMMUNITY_NAME', 'NODYX_COMMUNITY_DESCRIPTION', 'NODYX_COMMUNITY_LANGUAGE',
  'NODYX_COMMUNITY_COUNTRY', 'NODYX_MAX_MEMBERS', 'NODYX_GLOBAL_INDEXING', 'SECRET_X',
]

beforeEach(() => {
  vi.resetAllMocks()
  dbQueryMock.mockResolvedValue({ rows: [] })
  for (const k of TOUCHED) delete process.env[k]
})

afterEach(() => {
  for (const k of TOUCHED) delete process.env[k]
})

describe('loadSettingsIntoEnv', () => {
  it('injecte les non-secrets dans process.env et ignore les secrets', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [
      { key: 'NODYX_COMMUNITY_NAME', value: 'FromDB', is_secret: false },
      { key: 'SECRET_X',             value: 'ciphertext', is_secret: true },
    ] })
    await loadSettingsIntoEnv()
    expect(process.env.NODYX_COMMUNITY_NAME).toBe('FromDB')
    expect(process.env.SECRET_X).toBeUndefined()
  })

  it('la valeur DB écrase celle du .env (précédence)', async () => {
    process.env.NODYX_COMMUNITY_NAME = 'FromEnv'
    dbQueryMock.mockResolvedValueOnce({ rows: [
      { key: 'NODYX_COMMUNITY_NAME', value: 'FromDB', is_secret: false },
    ] })
    await loadSettingsIntoEnv()
    expect(process.env.NODYX_COMMUNITY_NAME).toBe('FromDB')
  })

  it('ne bloque jamais le boot si la requête échoue (fallback .env)', async () => {
    process.env.NODYX_COMMUNITY_NAME = 'FromEnv'
    dbQueryMock.mockRejectedValueOnce(new Error('relation does not exist'))
    await expect(loadSettingsIntoEnv()).resolves.toBeUndefined()
    expect(process.env.NODYX_COMMUNITY_NAME).toBe('FromEnv')
  })
})

describe('setSettings', () => {
  it('persiste, mute process.env à chaud, et ne demande pas de redémarrage (tier 3)', async () => {
    const r = await setSettings({ NODYX_COMMUNITY_NAME: 'Ma Communauté' }, 'actor-1')
    expect(r.ok).toBe(true)
    expect(r.applied).toContain('NODYX_COMMUNITY_NAME')
    expect(r.restartRequired).toBe(false)
    expect(process.env.NODYX_COMMUNITY_NAME).toBe('Ma Communauté')
    // au moins un INSERT instance_settings
    const sqls = dbQueryMock.mock.calls.map(c => String(c[0]))
    expect(sqls.some(s => s.includes('INSERT INTO instance_settings'))).toBe(true)
  })

  it('rejette une clé inconnue sans rien appliquer', async () => {
    const r = await setSettings({ FOO_BAR: 'x' }, 'actor-1')
    expect(r.ok).toBe(false)
    expect(r.errors.FOO_BAR).toBeDefined()
    expect(r.applied).toEqual([])
  })

  it('rejette une valeur requise vide', async () => {
    const r = await setSettings({ NODYX_COMMUNITY_NAME: '' }, 'actor-1')
    expect(r.ok).toBe(false)
    expect(r.errors.NODYX_COMMUNITY_NAME).toBeDefined()
  })

  it('rejette une langue hors liste', async () => {
    const r = await setSettings({ NODYX_COMMUNITY_LANGUAGE: 'xx' }, 'actor-1')
    expect(r.ok).toBe(false)
    expect(r.errors.NODYX_COMMUNITY_LANGUAGE).toBeDefined()
  })

  it('accepte un champ optionnel vidé (override .env → unlimited)', async () => {
    process.env.NODYX_MAX_MEMBERS = '50'
    const r = await setSettings({ NODYX_MAX_MEMBERS: '' }, 'actor-1')
    expect(r.ok).toBe(true)
    expect(process.env.NODYX_MAX_MEMBERS).toBe('')
  })

  it('normalise un booléen et l’applique', async () => {
    const r = await setSettings({ NODYX_GLOBAL_INDEXING: false }, 'actor-1')
    expect(r.ok).toBe(true)
    expect(process.env.NODYX_GLOBAL_INDEXING).toBe('false')
  })
})

describe('getEffectiveSettings', () => {
  it('ne renvoie jamais de valeur en clair pour un secret', () => {
    const list = getEffectiveSettings()
    for (const s of list) {
      if (s.secret) expect(s.value).toBeUndefined()
    }
  })
})
