import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'
import { fail } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = {}
	if (token) headers.Authorization = `Bearer ${token}`
	const status = url.searchParams.get('status') ?? 'open'
	const res = await apiFetch(fetch, `/admin/octoguard/reports?status=${encodeURIComponent(status)}`, { headers })
	const reports = res.ok ? (await res.json()).reports ?? [] : []
	return { reports, status }
}

export const actions: Actions = {
	patch: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form = await request.formData()
		const id = String(form.get('id') ?? '')
		const status = String(form.get('status') ?? '') as 'reviewed' | 'dismissed' | 'actioned'
		const resolution = String(form.get('resolution') ?? '') || undefined
		const res = await apiFetch(fetch, `/admin/octoguard/reports/${id}`, {
			method:  'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body:    JSON.stringify({ status, resolution }),
		})
		if (!res.ok) return fail(res.status, { error: 'Erreur mise à jour' })
		return { ok: true }
	},
}
