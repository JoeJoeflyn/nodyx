// ── Backup de clé E2E chiffré par passphrase ────────────────────────────────
// Sauvegarde la clé privée ECDH (exportée en JWK) chiffrée avec une clé dérivée
// de la passphrase de l'utilisateur (PBKDF2-SHA256 → AES-256-GCM). Le serveur ne
// stocke qu'un blob opaque (cf. /api/v1/users/me/key-backup). Serveur AVEUGLE.
// Module pur (WebCrypto) → fonctionne navigateur ET Node (testable).

const KDF = 'PBKDF2-SHA256'
const DEFAULT_ITERS = 600_000

export interface KeyBackup {
  blob:      string   // base64 : IV(12) + ciphertext AES-GCM
  salt:      string   // base64 : sel PBKDF2 (16 octets)
  kdf:       string
  kdf_iters: number
}

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function fromB64(str: string): Uint8Array {
  const bin = atob(str)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

async function deriveBackupKey(passphrase: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase) as BufferSource, 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iters, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Chiffre une clé privée (JWK stringifié) avec la passphrase → blob de backup. */
export async function encryptKeyBackup(privateKeyJwk: string, passphrase: string): Promise<KeyBackup> {
  if (!passphrase) throw new Error('passphrase required')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv   = crypto.getRandomValues(new Uint8Array(12))
  const key  = await deriveBackupKey(passphrase, salt, DEFAULT_ITERS)
  const ct   = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(privateKeyJwk),
  )
  const combined = new Uint8Array(iv.length + ct.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ct), iv.length)
  return { blob: toB64(combined), salt: toB64(salt), kdf: KDF, kdf_iters: DEFAULT_ITERS }
}

/** Déchiffre un blob de backup. Retourne le JWK, ou null si mauvaise passphrase. */
export async function decryptKeyBackup(backup: KeyBackup, passphrase: string): Promise<string | null> {
  try {
    const combined = fromB64(backup.blob)
    const iv  = combined.slice(0, 12)
    const ct  = combined.slice(12)
    const key = await deriveBackupKey(passphrase, fromB64(backup.salt), backup.kdf_iters || DEFAULT_ITERS)
    const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return new TextDecoder().decode(pt)
  } catch {
    return null   // mauvaise passphrase ou blob corrompu : échec propre
  }
}
