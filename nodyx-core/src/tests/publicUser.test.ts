import { describe, it, expect } from 'vitest'
import { toPublicUser, toSelfUser } from '../utils/publicUser'

// A realistic user row as it comes out of the DB. We always feed the helper a
// fully-populated object so we test exclusion, not "missing fields".
const FULL_USER = {
	id:                          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
	username:                    'pokled',
	email:                       'jaronoah@gmail.com',
	password:                    '$2b$12$dummyhash',
	avatar:                      '/uploads/avatars/x.png',
	bio:                         'hello',
	points:                      42,
	created_at:                  '2026-01-01T00:00:00Z',
	updated_at:                  '2026-05-21T00:00:00Z',
	linked_instances:            ['nodyx', 'somewhere-else'],
	email_verified:              true,
	email_verification_token:    'secret-token-xyz',
	password_reset_token:        'reset-secret-abc',
	password_reset_expires:      '2026-05-22T00:00:00Z',
	totp_enabled:                true,
	totp_secret:                 'TOTP-SECRET',
	registration_ip:             '1.2.3.4',
	public_key:                  'base64-key',
}

const PII_FIELDS = [
	'email',
	'password',
	'email_verified',
	'email_verification_token',
	'password_reset_token',
	'password_reset_expires',
	'totp_enabled',
	'totp_secret',
	'registration_ip',
]

describe('toPublicUser', () => {
	const out = toPublicUser(FULL_USER)

	it('exposes id, username, avatar, bio, points, created_at', () => {
		expect(out).toMatchObject({
			id:         FULL_USER.id,
			username:   FULL_USER.username,
			avatar:     FULL_USER.avatar,
			bio:        FULL_USER.bio,
			points:     FULL_USER.points,
			created_at: FULL_USER.created_at,
		})
	})

	it('never exposes any PII field', () => {
		for (const k of PII_FIELDS) {
			expect(out).not.toHaveProperty(k)
		}
	})

	it('does not expose self-only fields to the public view', () => {
		expect(out).not.toHaveProperty('linked_instances')
		expect(out).not.toHaveProperty('updated_at')
	})

	it('tolerates a null/undefined input', () => {
		expect(toPublicUser(null)).toEqual({})
		expect(toPublicUser(undefined)).toEqual({})
	})
})

describe('toSelfUser', () => {
	const out = toSelfUser(FULL_USER)

	it('includes everything from toPublicUser plus linked_instances + updated_at', () => {
		expect(out).toMatchObject({
			id:               FULL_USER.id,
			username:         FULL_USER.username,
			avatar:           FULL_USER.avatar,
			bio:              FULL_USER.bio,
			points:           FULL_USER.points,
			created_at:       FULL_USER.created_at,
			updated_at:       FULL_USER.updated_at,
			linked_instances: FULL_USER.linked_instances,
		})
	})

	it('never exposes any PII field, even to the user themselves', () => {
		// Email + tokens + 2FA secret stay backend-only by default. If a future
		// feature needs email in the self payload, add a dedicated endpoint
		// instead of widening this whitelist.
		for (const k of PII_FIELDS) {
			expect(out).not.toHaveProperty(k)
		}
	})

	it('tolerates a null/undefined input', () => {
		expect(toSelfUser(null)).toEqual({})
		expect(toSelfUser(undefined)).toEqual({})
	})
})
