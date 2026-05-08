// ─── Streamer Hub spike — wrapper Helix Twitch ───────────────────────────────
// - exchangeCode: code OAuth → access_token + refresh_token
// - refreshTokens: refresh_token → nouveau couple
// - getUser: GET /helix/users (identifie le streamer connecté)
// - createSubscription: POST /helix/eventsub/subscriptions (HMAC secret partagé)
// - listSubscriptions / deleteSubscription: pour debug / cleanup spike
//
// Toutes les fonctions throw { kind: 'twitch_error', status, body } sur erreur,
// pour que les routes puissent décider du code HTTP à renvoyer au user.

const TWITCH_OAUTH = 'https://id.twitch.tv/oauth2'
const TWITCH_HELIX = 'https://api.twitch.tv/helix'

export interface TwitchOAuthTokens {
  accessToken:  string
  refreshToken: string
  expiresIn:    number   // seconds
  scopes:       string[]
}

export interface TwitchUser {
  id:    string
  login: string
  email: string | null
  displayName: string
}

export class TwitchError extends Error {
  constructor(
    public readonly status: number,
    public readonly body:   unknown,
    message: string,
  ) {
    super(message)
    this.name = 'TwitchError'
  }
}

function clientId(): string {
  const v = process.env.TWITCH_CLIENT_ID
  if (!v) throw new Error('TWITCH_CLIENT_ID non défini')
  return v
}

function clientSecret(): string {
  const v = process.env.TWITCH_CLIENT_SECRET
  if (!v) throw new Error('TWITCH_CLIENT_SECRET non défini')
  return v
}

// ── OAuth ────────────────────────────────────────────────────────────────────

export function buildAuthorizeUrl(args: {
  redirectUri: string
  state:       string
  scopes:      string[]
  forceVerify?: boolean  // useful if user wants to re-trigger consent screen
}): string {
  const params = new URLSearchParams({
    client_id:     clientId(),
    redirect_uri:  args.redirectUri,
    response_type: 'code',
    scope:         args.scopes.join(' '),
    state:         args.state,
  })
  if (args.forceVerify) params.set('force_verify', 'true')
  return `${TWITCH_OAUTH}/authorize?${params.toString()}`
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TwitchOAuthTokens> {
  const res = await fetch(`${TWITCH_OAUTH}/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId(),
      client_secret: clientSecret(),
      code,
      grant_type:    'authorization_code',
      redirect_uri:  redirectUri,
    }),
  })
  if (!res.ok) throw new TwitchError(res.status, await res.text(), 'exchangeCode failed')

  const data = await res.json() as {
    access_token:  string
    refresh_token: string
    expires_in:    number
    scope:         string[] | undefined
  }
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresIn:    data.expires_in,
    scopes:       data.scope ?? [],
  }
}

export async function refreshTokens(refreshToken: string): Promise<TwitchOAuthTokens> {
  const res = await fetch(`${TWITCH_OAUTH}/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId(),
      client_secret: clientSecret(),
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) throw new TwitchError(res.status, await res.text(), 'refreshTokens failed')

  const data = await res.json() as {
    access_token:  string
    refresh_token: string
    expires_in:    number
    scope:         string[] | undefined
  }
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresIn:    data.expires_in,
    scopes:       data.scope ?? [],
  }
}

// ── Helix ────────────────────────────────────────────────────────────────────

async function helixGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${TWITCH_HELIX}${path}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id':     clientId(),
    },
  })
  if (!res.ok) throw new TwitchError(res.status, await res.text(), `Helix GET ${path} failed`)
  return await res.json() as T
}

async function helixPost<T>(path: string, accessToken: string, body: unknown): Promise<T> {
  const res = await fetch(`${TWITCH_HELIX}${path}`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id':     clientId(),
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new TwitchError(res.status, await res.text(), `Helix POST ${path} failed`)
  return await res.json() as T
}

export async function getCurrentUser(accessToken: string): Promise<TwitchUser> {
  const data = await helixGet<{ data: Array<{ id: string; login: string; email?: string; display_name: string }> }>(
    '/users',
    accessToken,
  )
  if (!data.data.length) throw new TwitchError(404, data, 'getCurrentUser empty data')
  const u = data.data[0]
  return {
    id:          u.id,
    login:       u.login,
    email:       u.email ?? null,
    displayName: u.display_name,
  }
}

// ── EventSub subscriptions ───────────────────────────────────────────────────
// Phase 0 : on souscrit `stream.online` qui ne demande aucun scope, juste un
// App Access Token. C'est le canary parfait pour valider la chaîne webhook
// HMAC sans embarquer la complexité des scopes user.

export interface CreatedSubscription {
  id:        string
  status:    string
  type:      string
  condition: Record<string, string>
}

export async function createStreamOnlineSubscription(args: {
  appAccessToken: string  // App Access Token (client_credentials), pas user token
  broadcasterId:  string  // l'externalId du streamer
  callbackUrl:    string  // URL complète avec nonce: https://nodyx.org/api/v1/integrations/twitch/eventsub/{nonce}
  hmacSecret:     string  // 10-100 chars (Twitch valide entre 10 et 100 ASCII)
}): Promise<CreatedSubscription> {
  const data = await helixPost<{ data: CreatedSubscription[] }>('/eventsub/subscriptions', args.appAccessToken, {
    type:    'stream.online',
    version: '1',
    condition: { broadcaster_user_id: args.broadcasterId },
    transport: {
      method:   'webhook',
      callback: args.callbackUrl,
      secret:   args.hmacSecret,
    },
  })
  if (!data.data.length) throw new TwitchError(500, data, 'createSubscription empty response')
  return data.data[0]
}

export async function deleteSubscription(appAccessToken: string, subscriptionId: string): Promise<void> {
  const res = await fetch(`${TWITCH_HELIX}/eventsub/subscriptions?id=${encodeURIComponent(subscriptionId)}`, {
    method:  'DELETE',
    headers: {
      'Authorization': `Bearer ${appAccessToken}`,
      'Client-Id':     clientId(),
    },
  })
  if (res.status !== 204) throw new TwitchError(res.status, await res.text(), 'deleteSubscription failed')
}

export async function listSubscriptions(appAccessToken: string): Promise<unknown> {
  return helixGet('/eventsub/subscriptions', appAccessToken)
}

// ── App Access Token (client_credentials) ────────────────────────────────────
// Pour souscrire à EventSub sans embarquer le user token. Cached 50 j en Redis,
// déjà géré par routes/twitch.ts existant — mais le spike n'y touche pas pour
// rester totalement isolé. On (re)demande un token frais à chaque souscription
// pendant le spike (acceptable, faible volume), Phase 1 reprendra le cache.

export async function getAppAccessToken(): Promise<string> {
  const res = await fetch(`${TWITCH_OAUTH}/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId(),
      client_secret: clientSecret(),
      grant_type:    'client_credentials',
    }),
  })
  if (!res.ok) throw new TwitchError(res.status, await res.text(), 'getAppAccessToken failed')
  const data = await res.json() as { access_token: string }
  return data.access_token
}
