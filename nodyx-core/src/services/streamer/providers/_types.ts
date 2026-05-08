// ─── Streamer Hub — interface provider ───────────────────────────────────────
// Cette interface est implémentée par chaque provider (Twitch en Phase 1,
// Owncast / PeerTube / YouTube Live / Kick possibles plus tard sans toucher
// au moteur Streamer Hub). Voir spec §2.2.

export type ProviderId = 'twitch' | 'owncast' | 'peertube' | 'youtube' | 'kick'

export interface OAuthTokens {
  accessToken:  string
  refreshToken: string
  expiresIn:    number   // seconds
  scopes:       string[]
}

export interface ProviderUser {
  id:          string
  login:       string
  displayName: string
  email:       string | null
}

export interface CreatedSubscription {
  externalSubId: string
  status:        string
  type:          string
  condition:     Record<string, string>
}

export interface StreamerProvider {
  readonly id:    ProviderId
  readonly label: string

  // ── OAuth flow (streamer login) ────────────────────────────────────────────
  buildAuthorizeUrl(args: {
    redirectUri: string
    state:       string
    scopes:      string[]
    forceVerify?: boolean
  }): string

  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>

  refreshTokens(refreshToken: string): Promise<OAuthTokens>

  getCurrentUser(accessToken: string): Promise<ProviderUser>

  // ── EventSub / webhooks subscription management ────────────────────────────
  createEventSubscription(args: {
    appAccessToken: string
    eventType:      string
    condition:      Record<string, string>
    callbackUrl:    string
    hmacSecret:     string
  }): Promise<CreatedSubscription>

  deleteEventSubscription(appAccessToken: string, externalSubId: string): Promise<void>

  // App Access Token (client_credentials grant) — utilisé pour les opérations
  // qui ne dépendent pas d'un user spécifique (ex: subscribe EventSub).
  getAppAccessToken(): Promise<string>
}

// ── Erreur unifiée pour les providers ────────────────────────────────────────
export class ProviderError extends Error {
  constructor(
    public readonly providerId: ProviderId,
    public readonly status:     number,
    public readonly body:       unknown,
    message: string,
  ) {
    super(`[${providerId}] ${message}`)
    this.name = 'ProviderError'
  }
}
