// ─── Streamer Hub — tests négatifs de chiffrement (§12.1) ────────────────────
// Garantie : un blob chiffré ne se déchiffre PAS si on altère un seul élément
// (master key, sel, IV, tag, ciphertext). Critique pour empêcher qu'un refactor
// silencieux ne dégrade le chiffrement (ex: passer de GCM à ECB sans tag).

import { describe, it, expect, beforeAll } from 'vitest'
import { randomBytes } from 'node:crypto'

const VALID_KEY_HEX = '0'.repeat(64)  // 32 bytes hex, deterministic for test repeatability

beforeAll(() => {
  process.env.STREAMER_OAUTH_KEY = VALID_KEY_HEX
})

// Import après set de l'env var pour que loadMasterKey trouve la valeur
import { encrypt, decrypt } from '../services/streamer/crypto'

describe('streamer crypto — round-trip', () => {
  it('déchiffre correctement un texte qu\'on vient de chiffrer', () => {
    const plain = 'twitch_access_token_3vM5n8aPq...'
    const blob  = encrypt(plain)
    expect(decrypt(blob)).toBe(plain)
  })

  it('produit un ciphertext différent à chaque appel (IV + sel uniques)', () => {
    const plain = 'same input'
    const a = encrypt(plain)
    const b = encrypt(plain)
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false)
    expect(a.iv.equals(b.iv)).toBe(false)
    expect(a.salt.equals(b.salt)).toBe(false)
  })
})

describe('streamer crypto — tests négatifs (§12.1)', () => {
  it('échoue si la master key change après chiffrement', () => {
    const blob = encrypt('secret')
    process.env.STREAMER_OAUTH_KEY = '1'.repeat(64)
    expect(() => decrypt(blob)).toThrow()
    process.env.STREAMER_OAUTH_KEY = VALID_KEY_HEX  // restore
  })

  it('échoue si on altère le sel (HKDF dérive une clé différente)', () => {
    const blob = encrypt('secret')
    const tampered = { ...blob, salt: randomBytes(blob.salt.length) }
    expect(() => decrypt(tampered)).toThrow()
  })

  it('échoue si on altère l\'IV', () => {
    const blob = encrypt('secret')
    const tampered = { ...blob, iv: randomBytes(blob.iv.length) }
    expect(() => decrypt(tampered)).toThrow()
  })

  it('échoue si on altère le tag GCM', () => {
    const blob = encrypt('secret')
    const tampered = { ...blob, tag: randomBytes(blob.tag.length) }
    expect(() => decrypt(tampered)).toThrow()
  })

  it('échoue si on altère un seul octet du ciphertext', () => {
    const blob = encrypt('secret')
    const cipher = Buffer.from(blob.ciphertext)
    cipher[0] = (cipher[0] ^ 0xff) & 0xff
    const tampered = { ...blob, ciphertext: cipher }
    expect(() => decrypt(tampered)).toThrow()
  })

  it('échoue avec une longueur d\'IV invalide (refus avant déchiffrement)', () => {
    const blob = encrypt('secret')
    const tampered = { ...blob, iv: Buffer.alloc(8) }  // GCM exige 12 octets
    expect(() => decrypt(tampered)).toThrow(/iv longueur invalide/)
  })

  it('refuse une master key trop courte', () => {
    process.env.STREAMER_OAUTH_KEY = 'tropcourt'
    expect(() => encrypt('x')).toThrow(/STREAMER_OAUTH_KEY/)
    process.env.STREAMER_OAUTH_KEY = VALID_KEY_HEX
  })

  it('refuse une master key absente', () => {
    delete process.env.STREAMER_OAUTH_KEY
    expect(() => encrypt('x')).toThrow(/STREAMER_OAUTH_KEY/)
    process.env.STREAMER_OAUTH_KEY = VALID_KEY_HEX
  })
})
