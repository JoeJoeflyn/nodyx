// ─── Streamer Hub spike — AES-256-GCM + HKDF (§12.1) ─────────────────────────
// Defense-in-depth : chaque token a un sel par row. La clé de chiffrement réelle
// est dérivée HKDF(master, salt). Une fuite DB seule ne suffit pas à déchiffrer.
//
// Format on-disk :
//   ciphertext: bytes
//   salt:       16 bytes  (HKDF salt, par row)
//   iv:         12 bytes  (IV GCM, unique par chiffrement)
//   tag:        16 bytes  (tag GCM)
//   keyVersion: integer   (master_key_v{N}, rotation mensuelle en Phase 5)

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const ALGO          = 'aes-256-gcm'
const KEY_LEN       = 32
const SALT_LEN      = 16
const IV_LEN        = 12
const TAG_LEN       = 16
const HKDF_INFO     = Buffer.from('nodyx-streamer-token-v1')

export interface EncryptedBlob {
  ciphertext: Buffer
  salt:       Buffer
  iv:         Buffer
  tag:        Buffer
  keyVersion: number
}

function loadMasterKey(version: number): Buffer {
  const envName = version === 1 ? 'STREAMER_OAUTH_KEY' : `STREAMER_OAUTH_KEY_V${version}`
  const hex = process.env[envName]
  if (!hex || hex.length !== KEY_LEN * 2) {
    throw new Error(
      `${envName} doit être 32 octets hex (64 caractères). Genere avec: ` +
      `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    )
  }
  return Buffer.from(hex, 'hex')
}

function deriveKey(master: Buffer, salt: Buffer): Buffer {
  // hkdfSync retourne ArrayBuffer, on le wrap en Buffer pour l'API node crypto
  return Buffer.from(hkdfSync('sha256', master, salt, HKDF_INFO, KEY_LEN))
}

export function encrypt(plaintext: string, keyVersion = 1): EncryptedBlob {
  const master = loadMasterKey(keyVersion)
  const salt   = randomBytes(SALT_LEN)
  const iv     = randomBytes(IV_LEN)
  const key    = deriveKey(master, salt)

  const cipher     = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag        = cipher.getAuthTag()

  return { ciphertext, salt, iv, tag, keyVersion }
}

export function decrypt(blob: EncryptedBlob): string {
  if (blob.salt.length !== SALT_LEN) throw new Error('salt longueur invalide')
  if (blob.iv.length   !== IV_LEN)   throw new Error('iv longueur invalide')
  if (blob.tag.length  !== TAG_LEN)  throw new Error('tag longueur invalide')

  const master = loadMasterKey(blob.keyVersion)
  const key    = deriveKey(master, blob.salt)

  const decipher = createDecipheriv(ALGO, key, blob.iv)
  decipher.setAuthTag(blob.tag)

  // Si le tag est invalide (clé fausse / sel altéré / IV altéré / ciphertext altéré),
  // .final() throw — c'est exactement ce qu'on teste dans __tests__/crypto.test.ts.
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]).toString('utf8')
}
