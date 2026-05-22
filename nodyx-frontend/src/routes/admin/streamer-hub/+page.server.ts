import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token } = await parent()
	const auth = { headers: { Authorization: `Bearer ${token}` } }

	// Loads in parallel: connected streamers, EventSub subs, recent events, hub health.
	const [meRes, subsRes, eventsRes, healthRes] = await Promise.all([
		apiFetch(fetch, '/streamer/twitch/me',             auth),
		apiFetch(fetch, '/streamer/twitch/eventsub-status', auth),
		apiFetch(fetch, '/streamer/events?limit=20',        auth),
		apiFetch(fetch, '/streamer/health',                 auth),
	])

	const me     = meRes.ok     ? await meRes.json()     : { streamers: [] }
	const status = subsRes.ok   ? await subsRes.json()   : { subscriptions: [], primaryStreamer: null }
	const events = eventsRes.ok ? await eventsRes.json() : { events: [] }
	const health = healthRes.ok ? await healthRes.json() : null

	return {
		streamers:        me.streamers ?? [],
		primaryStreamer:  status.primaryStreamer ?? null,
		subscriptions:    status.subscriptions ?? [],
		recentEvents:     events.events ?? [],
		health,
	}
}
