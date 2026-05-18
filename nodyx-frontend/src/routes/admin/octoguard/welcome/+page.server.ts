import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'
import { fail } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = {}
	if (token) headers.Authorization = `Bearer ${token}`
	const res = await apiFetch(fetch, '/admin/octoguard/welcome', { headers })
	const data = res.ok ? await res.json() : { welcome: null }
	return { welcome: data.welcome }
}

export const actions: Actions = {
	save: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form = await request.formData()
		const body = {
			channel_id:     (form.get('channel_id') as string)?.trim() || null,
			public_message: (form.get('public_message') as string) || null,
			dm_message:     null,  // DM système : reporté à spec 019
			dm_enabled:     false,
			auto_grade_id:  (form.get('auto_grade_id') as string)?.trim() || null,
			enabled:        form.get('enabled') === '1',
		}
		const res = await apiFetch(fetch, '/admin/octoguard/welcome', {
			method:  'PUT',
			headers: { Authorization: `Bearer ${token}` },
			body:    JSON.stringify(body),
		})
		if (!res.ok) return fail(res.status, { error: 'Erreur de sauvegarde' })
		return { ok: true }
	},
}
