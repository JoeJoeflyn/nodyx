import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'
import { fail } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = {}
	if (token) headers.Authorization = `Bearer ${token}`
	const res = await apiFetch(fetch, '/admin/octoguard/commands', { headers })
	const commands = res.ok ? (await res.json()).commands ?? [] : []
	return { commands }
}

export const actions: Actions = {
	create: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form = await request.formData()
		const body = {
			command:          String(form.get('command') ?? '').trim().toLowerCase(),
			response:         String(form.get('response') ?? '').trim(),
			cooldown_seconds: parseInt(String(form.get('cooldown_seconds') ?? '5'), 10),
			enabled:          form.get('enabled') !== '0',
		}
		const res = await apiFetch(fetch, '/admin/octoguard/commands', {
			method:  'POST',
			headers: { Authorization: `Bearer ${token}` },
			body:    JSON.stringify(body),
		})
		if (!res.ok) {
			const j = await res.json().catch(() => ({}))
			return fail(res.status, { error: j.error ?? 'Erreur création' })
		}
		return { ok: true }
	},

	delete: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const id = String((await request.formData()).get('id') ?? '')
		const res = await apiFetch(fetch, `/admin/octoguard/commands/${id}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) return fail(res.status, { error: 'Erreur suppression' })
		return { ok: true }
	},
}
