import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'
import { fail } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = {}
	if (token) headers.Authorization = `Bearer ${token}`
	const res = await apiFetch(fetch, '/admin/octoguard/webhook', { headers })
	const data = res.ok ? await res.json() : { webhook: null }
	return { webhook: data.webhook }
}

export const actions: Actions = {
	save: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form = await request.formData()
		const url    = String(form.get('url') ?? '').trim() || null
		const secret = String(form.get('secret') ?? '').trim() || undefined
		const body = {
			url,
			...(secret ? { secret } : {}),
			enabled: form.get('enabled') === '1',
		}
		const res = await apiFetch(fetch, '/admin/octoguard/webhook', {
			method:  'PUT',
			headers: { Authorization: `Bearer ${token}` },
			body:    JSON.stringify(body),
		})
		if (!res.ok) {
			const j = await res.json().catch(() => ({}))
			return fail(res.status, { error: j.error ?? 'Erreur de sauvegarde' })
		}
		return { ok: true }
	},
}
