import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'
import { fail } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = {}
	if (token) headers.Authorization = `Bearer ${token}`
	const page = url.searchParams.get('page') ?? '1'
	const action = url.searchParams.get('action') ?? ''
	const q = new URLSearchParams({ page, limit: '50' })
	if (action) q.set('action', action)
	const res = await apiFetch(fetch, `/admin/octoguard/logs?${q.toString()}`, { headers })
	const data = res.ok ? await res.json() : { logs: [], total: 0, page: 1, limit: 50 }
	return { ...data, action }
}

export const actions: Actions = {
	undo: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const id = String((await request.formData()).get('id') ?? '')
		const res = await apiFetch(fetch, `/admin/octoguard/logs/${id}/undo`, {
			method:  'POST',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) {
			const j = await res.json().catch(() => ({}))
			return fail(res.status, { error: j.error ?? 'Annulation impossible' })
		}
		return { ok: true }
	},
}
