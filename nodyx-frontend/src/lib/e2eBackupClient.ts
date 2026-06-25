// ── Liaison backup de clé E2E : crypto (e2eBackup) + API (/users/me/key-backup) ──
// Orchestration côté client. Le serveur ne reçoit qu'un blob opaque.
import {
	exportIdentityKeyJwk, restoreIdentityKeyJwk, registerPublicKey, hasKeyPair,
	regenerateKeyPair,
} from './e2e'
import { encryptKeyBackup, decryptKeyBackup, type KeyBackup } from './e2eBackup'

function authHeaders(token: string, json = false): Record<string, string> {
	const h: Record<string, string> = { Authorization: `Bearer ${token}` }
	if (json) h['Content-Type'] = 'application/json'
	return h
}

/** Récupère le blob de backup du user, ou null s'il n'en a pas. */
export async function getServerBackup(token: string): Promise<KeyBackup | null> {
	try {
		const res = await fetch('/api/v1/users/me/key-backup', { headers: authHeaders(token) })
		if (!res.ok) return null
		const j = await res.json()
		return (j.backup as KeyBackup) ?? null
	} catch {
		return null
	}
}

/** Un backup existe-t-il côté serveur ? (détection nouvel appareil) */
export async function hasServerBackup(token: string): Promise<boolean> {
	return !!(await getServerBackup(token))
}

/** La clé locale est-elle sauvegardable (extractable) ? */
export async function canBackupLocalKey(): Promise<boolean> {
	try { await exportIdentityKeyJwk(); return true } catch { return false }
}

/**
 * Sauvegarde la clé locale, chiffrée par la passphrase, sur le serveur.
 * Échoue si la clé locale est non-extractable (ancienne clé pré-backup).
 */
export async function uploadKeyBackup(token: string, passphrase: string): Promise<boolean> {
	const jwk = await exportIdentityKeyJwk()
	const backup = await encryptKeyBackup(jwk, passphrase)
	const res = await fetch('/api/v1/users/me/key-backup', {
		method: 'PUT', headers: authHeaders(token, true), body: JSON.stringify(backup),
	})
	return res.ok
}

/**
 * Restaure la clé depuis le backup serveur avec la passphrase.
 * Retourne false si pas de backup ou mauvaise passphrase (échec propre).
 */
export async function restoreKeyBackup(token: string, passphrase: string): Promise<boolean> {
	const backup = await getServerBackup(token)
	if (!backup) return false
	const jwk = await decryptKeyBackup(backup, passphrase)
	if (!jwk) return false   // mauvaise passphrase
	await restoreIdentityKeyJwk(jwk)
	// Ré-enregistre la clé publique restaurée pour que les pairs l'utilisent.
	await registerPublicKey(token)
	return true
}

/** Supprime le backup serveur (réinitialisation). */
export async function deleteKeyBackup(token: string): Promise<boolean> {
	const res = await fetch('/api/v1/users/me/key-backup', { method: 'DELETE', headers: authHeaders(token) })
	return res.ok
}

/** Faut-il proposer une restauration ? (pas de clé locale mais un backup existe) */
export async function shouldOfferRestore(token: string): Promise<boolean> {
	if (await hasKeyPair()) return false
	return hasServerBackup(token)
}

/**
 * Régénère une clé extractable (sauvegardable). Remplace la clé locale →
 * l'historique chiffré sur cet appareil devient illisible. Confirmation requise.
 */
export async function regenerateKey(token: string): Promise<boolean> {
	try { await regenerateKeyPair(token); return true } catch { return false }
}
