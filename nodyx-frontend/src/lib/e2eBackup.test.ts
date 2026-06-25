import { describe, it, expect } from 'vitest'
import { encryptKeyBackup, decryptKeyBackup } from './e2eBackup'

// Charge utile représentative : un JWK de clé privée ECDH P-256 (stringifié).
const SAMPLE_JWK = JSON.stringify({
	kty: 'EC', crv: 'P-256',
	d: 'r4Nt7Q_privatecomponent_base64url',
	x: 'AbCdEf_xcoord', y: 'GhIjKl_ycoord',
	key_ops: ['deriveKey', 'deriveBits'], ext: true,
})

describe('e2eBackup — chiffrement de clé par passphrase', () => {
	it('round-trip : la bonne passphrase restaure la clé à l\'identique', async () => {
		const backup = await encryptKeyBackup(SAMPLE_JWK, 'ma-phrase-de-recuperation-42')
		expect(backup.blob).toBeTruthy()
		expect(backup.salt).toBeTruthy()
		expect(backup.kdf).toBe('PBKDF2-SHA256')
		expect(backup.kdf_iters).toBeGreaterThan(100_000)

		const restored = await decryptKeyBackup(backup, 'ma-phrase-de-recuperation-42')
		expect(restored).toBe(SAMPLE_JWK)
	})

	it('mauvaise passphrase → null (échec propre, pas de crash)', async () => {
		const backup = await encryptKeyBackup(SAMPLE_JWK, 'bonne-phrase')
		const restored = await decryptKeyBackup(backup, 'mauvaise-phrase')
		expect(restored).toBeNull()
	})

	it('sel + blob uniques à chaque chiffrement (pas de réutilisation d\'IV/sel)', async () => {
		const b1 = await encryptKeyBackup(SAMPLE_JWK, 'p')
		const b2 = await encryptKeyBackup(SAMPLE_JWK, 'p')
		expect(b1.salt).not.toBe(b2.salt)
		expect(b1.blob).not.toBe(b2.blob)
	})

	it('blob altéré → null (AES-GCM authentifié)', async () => {
		const backup = await encryptKeyBackup(SAMPLE_JWK, 'p')
		const tampered = { ...backup, blob: backup.blob.slice(0, -4) + 'AAAA' }
		const restored = await decryptKeyBackup(tampered, 'p')
		expect(restored).toBeNull()
	})

	it('passphrase vide → rejet', async () => {
		await expect(encryptKeyBackup(SAMPLE_JWK, '')).rejects.toThrow()
	})
})
