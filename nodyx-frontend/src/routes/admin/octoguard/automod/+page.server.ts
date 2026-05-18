import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'
import { fail } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = {}
	if (token) headers.Authorization = `Bearer ${token}`

	const res = await apiFetch(fetch, '/admin/octoguard/rules', { headers })
	const rules = res.ok ? (await res.json()).rules ?? [] : []
	return { rules }
}

function parseRuleBody(form: FormData) {
	const name   = String(form.get('name') ?? '').trim()
	const type   = String(form.get('type') ?? '').trim()
	const action = String(form.get('action') ?? '').trim()
	const paramsRaw = String(form.get('params') ?? '{}').trim()
	let params: unknown = {}
	try { params = JSON.parse(paramsRaw) } catch { /* will be rejected by Zod */ }

	const durationRaw = String(form.get('action_duration') ?? '').trim()
	let action_duration: unknown = null
	if (durationRaw) {
		try { action_duration = JSON.parse(durationRaw) } catch { /* null */ }
	}

	const immRolesRaw = String(form.get('immunized_role_types') ?? '').trim()
	const immunized_role_types = immRolesRaw
		? immRolesRaw.split(',').map(s => s.trim()).filter(Boolean)
		: undefined

	return {
		name, type, action, params,
		action_duration,
		immunized_role_types,
		dry_run: form.get('dry_run') === '1',
		enabled: form.get('enabled') !== '0',
	}
}

export const actions: Actions = {
	create: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const body = parseRuleBody(await request.formData())
		const res = await apiFetch(fetch, '/admin/octoguard/rules', {
			method:  'POST',
			headers: { Authorization: `Bearer ${token}` },
			body:    JSON.stringify(body),
		})
		if (!res.ok) {
			const json = await res.json().catch(() => ({}))
			return fail(res.status, { error: json.error ?? 'Erreur création', assessment: json.assessment ?? null })
		}
		return { ok: true }
	},

	update: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form = await request.formData()
		const id = String(form.get('id') ?? '')
		if (!id) return fail(400, { error: 'ID manquant' })
		const body = parseRuleBody(form)
		const res = await apiFetch(fetch, `/admin/octoguard/rules/${id}`, {
			method:  'PUT',
			headers: { Authorization: `Bearer ${token}` },
			body:    JSON.stringify(body),
		})
		if (!res.ok) {
			const json = await res.json().catch(() => ({}))
			return fail(res.status, { error: json.error ?? 'Erreur mise à jour', assessment: json.assessment ?? null })
		}
		return { ok: true }
	},

	delete: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form = await request.formData()
		const id = String(form.get('id') ?? '')
		const res = await apiFetch(fetch, `/admin/octoguard/rules/${id}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) return fail(res.status, { error: 'Erreur suppression' })
		return { ok: true }
	},
}
