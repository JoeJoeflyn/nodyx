import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = {}
	if (token) headers.Authorization = `Bearer ${token}`

	async function safeGet(path: string) {
		try {
			const res = await apiFetch(fetch, path, { headers })
			if (!res.ok) return null
			return await res.json()
		} catch { return null }
	}

	const [settings, rulesData, mutesData, reportsData] = await Promise.all([
		safeGet('/admin/octoguard/settings'),
		safeGet('/admin/octoguard/rules'),
		safeGet('/admin/octoguard/mutes?active=true'),
		safeGet('/admin/octoguard/reports?status=open'),
	])

	return {
		settings,
		rules:        rulesData?.rules ?? [],
		activeMutes:  mutesData?.mutes ?? [],
		openReports:  reportsData?.reports ?? [],
	}
}
