import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'
import { fail } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = {}
	if (token) headers.Authorization = `Bearer ${token}`
	const res = await apiFetch(fetch, '/admin/octoguard/mutes?active=true', { headers })
	const mutes = res.ok ? (await res.json()).mutes ?? [] : []
	return { mutes }
}

export const actions: Actions = {
	create: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form = await request.formData()
		const userId = String(form.get('user_id') ?? '').trim()
		const dur = String(form.get('duration_value') ?? '').trim()
		const unit = String(form.get('duration_unit') ?? 'h').trim() as 'm' | 'h' | 'd' | 'w' | 'M'
		const body = {
			user_id:    userId,
			channel_id: (form.get('channel_id') as string)?.trim() || null,
			duration:   dur ? { value: parseInt(dur, 10), unit } : null,
			reason:     (form.get('reason') as string)?.trim() || undefined,
		}
		const res = await apiFetch(fetch, '/admin/octoguard/mutes', {
			method:  'POST',
			headers: { Authorization: `Bearer ${token}` },
			body:    JSON.stringify(body),
		})
		if (!res.ok) {
			const j = await res.json().catch(() => ({}))
			return fail(res.status, { error: j.error ?? 'Erreur application mute' })
		}
		return { ok: true }
	},

	unmute: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const id = String((await request.formData()).get('id') ?? '')
		const res = await apiFetch(fetch, `/admin/octoguard/mutes/${id}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) return fail(res.status, { error: 'Erreur unmute' })
		return { ok: true }
	},
}
