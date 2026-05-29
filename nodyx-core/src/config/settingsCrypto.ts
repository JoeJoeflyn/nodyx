// ─── Chiffrement des secrets de configuration (spec 017 Phase 2) ──────────────
// Même schéma que services/streamer/crypto.ts (AES-256-GCM + sel HKDF par row),
// mais clé maître dérivée de JWT_SECRET (toujours présent au boot) plutôt que
// de STREAMER_OAUTH_KEY (spécifique au streamer hub, pas universel). Un override
// dédié SETTINGS_SECRET_KEY (32 octets hex) est utilisé en priorité s'il existe.
//
// Conséquence de fond : si JWT_SECRET est tourné, les secrets stockés deviennent
// indéchiffrables (il faudra les re-saisir). C'est cohérent : tourner JWT_SECRET
// est déjà une action lourde (déconnexion globale). Pour découpler, définir
// SETTINGS_SECRET_KEY.
//
// Une fuite de la DB seule ne suffit pas à déchiffrer (il faut aussi la clé
// maître, qui vit dans le .env). Le tag GCM garantit l'authenticité.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const ALGO      = 'aes-256-gcm'
const KEY_LEN   = 32
const SALT_LEN  = 16
const IV_LEN    = 12
const TAG_LEN   = 16
const HKDF_INFO = Buffer.from('nodyx-settings-v1')

export interface SettingBlob {
  ciphertext: Buffer
  salt:       Buffer
  iv:         Buffer
  tag:        Buffer
}

// IKM (input keying material) : SETTINGS_SECRET_KEY hex si présent, sinon
// JWT_SECRET (n'importe quelle longueur, HKDF s'en accommode).
function masterIKM(): Buffer {
  const dedicated = process.env.SETTINGS_SECRET_KEY
  if (dedicated && dedicated.length === KEY_LEN * 2) return Buffer.from(dedicated, 'hex')
  const jwt = process.env.JWT_SECRET
  if (!jwt) throw new Error('JWT_SECRET requis pour chiffrer les secrets de configuration')
  return Buffer.from(jwt, 'utf8')
}

function deriveKey(salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterIKM(), salt, HKDF_INFO, KEY_LEN))
}

export function encryptSecret(plaintext: string): SettingBlob {
  const salt = randomBytes(SALT_LEN)
  const iv   = randomBytes(IV_LEN)
  const key  = deriveKey(salt)

  const cipher     = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag        = cipher.getAuthTag()

  return { ciphertext, salt, iv, tag }
}

export function decryptSecret(blob: SettingBlob): string {
  if (blob.salt.length !== SALT_LEN) throw new Error('salt longueur invalide')
  if (blob.iv.length   !== IV_LEN)   throw new Error('iv longueur invalide')
  if (blob.tag.length  !== TAG_LEN)  throw new Error('tag longueur invalide')

  const key      = deriveKey(blob.salt)
  const decipher = createDecipheriv(ALGO, key, blob.iv)
  decipher.setAuthTag(blob.tag)
  // Tag invalide (clé/sel/iv/ciphertext altéré) => .final() throw.
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]).toString('utf8')
}
