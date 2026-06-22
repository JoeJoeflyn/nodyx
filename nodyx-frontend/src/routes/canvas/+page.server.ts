import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies, parent }) => {
	const { modules } = await parent()
	if (!modules?.canvas) throw error(404, 'Le module Canvas est désactivé sur cette instance.')

	const token = cookies.get('token')
	if (!token) redirect(303, '/auth/login')

	const res = await apiFetch(fetch, '/canvas/boards', {
		headers: { Authorization: `Bearer ${token}` }
	})
	const { boards } = res.ok ? await res.json() : { boards: [] }
	return { boards, token }
}
