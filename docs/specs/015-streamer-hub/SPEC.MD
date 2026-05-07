# Nodyx Streamer Hub

**Statut** : validée — Phase 1 prête à être implémentée
**Numéro de spec** : 015
**Date de validation** : 2026-05-07
**Auteur** : Pokled + Claude
**Phase cible** : v2.5 (Phase 1) → v2.7 (Phase 5 complète)

---

## 1. Vision & principes

Un streamer aujourd'hui paye, jongle ou subit une dizaine d'outils :

| Besoin | Service classique |
|---|---|
| Alertes en stream | Streamlabs / StreamElements |
| Stream Deck | Elgato (matériel, ~150€) ou Touch Portal (logiciel) |
| Statistiques | StreamElements / TwitchTracker |
| Chat unifié | Streamer.bot / Botisimo |
| Communauté hors stream | Discord (gratuit mais GAFAM, modération limitée) |
| Polls / sondages animés | StreamElements / Beeyou |
| Top clips à l'écran | Streamer.bot scripts maison |
| Extension Twitch perso | Codée à la main (3-4 jours pour un dev) |

Aucun de ces outils n'est pensé comme un environnement complet. Ils s'empilent, leurs intégrations cassent à chaque update Twitch, et le streamer paye plusieurs abonnements pour avoir un service correct.

**Nodyx Streamer Hub** est un module qui transforme une instance Nodyx en environnement complet pour un streamer : alertes live, chat unifié Twitch ↔ Nodyx, Stream Deck web, statistiques natives, gestion de polls, top clips à l'écran, et un générateur d'extension Twitch qui pointe vers l'instance. Le tout libre, auto-hébergé, et intégré au reste de Nodyx (forum, vocal, canvas) qui devient l'espace de communauté du streamer.

### Principes

- **Souveraineté du streamer sur son audience.** Les viewers vivent chez le streamer, pas dans un silo tiers. Le streamer peut quitter Twitch un jour, sa communauté reste avec lui sur son instance.
- **Pas anti-Twitch, pas anti-GAFAM dogmatique.** Twitch concentre l'audience, on s'y interface. Mais l'architecture est en *providers* : Twitch est le premier, Owncast / PeerTube / YouTube Live / Kick peuvent être ajoutés sans réécrire le moteur. Une instance Nodyx n'est jamais piégée dans un seul écosystème de stream.
- **Réutilisation maximale de l'existant.** Le chat est le chat Nodyx existant. Les threads sont les threads Nodyx existants. Les polls sont les polls Nodyx existants. Le Streamer Hub orchestre, il ne réinvente pas.
- **Une instance = un streamer principal.** Cohérent avec "une instance = une communauté". Les mods peuvent voir/configurer, mais il y a un seul streamer "owner" du hub.
- **Pas de SaaS cloud.** Chaque instance est autonome. Aucun "Streamer Hub Pro" hosté par nodyx.org. Le streamer paye son VPS, point.
- **Tokens chiffrés au repos.** AES-256-GCM avec clé par instance (`STREAMER_OAUTH_KEY` env var). Si la DB fuite, les tokens ne sont pas exploitables sans accès au filesystem.

### Tradeoff principal accepté

Twitch peut deprecate des endpoints / events sans grand préavis. On accepte une dette de maintenance liée à l'API Twitch (versionnée, on suit l'évolution). C'est la rançon d'avoir une vraie intégration plutôt qu'un scraping fragile.

### Non-vision (ce que le module ne fait PAS)

- **Pas de bot Discord.** Le streamer migre sa communauté **vers** Nodyx, pas l'inverse.
- **Pas de relai vers un service hébergé par nodyx.org.** Tout tourne sur l'instance du streamer.
- **Pas un fork de Streamlabs.** Le code est natif Nodyx, pas une couche compat.
- **Pas de plateforme de streaming.** Nodyx ne stream pas, il s'interface.

---

## 2. Architecture & composants

### 2.1 Module Nodyx activable

Le Streamer Hub s'inscrit dans le système de modules de Nodyx (cf [`docs/specs/MODULE_SYSTEM`](../MODULE_SYSTEM.md) / `.claude/ideas/MODULE_SYSTEM.md`). L'admin de l'instance l'active depuis `/admin/modules`. Une fois actif :
- L'onglet **Streamer Hub** apparaît dans la sidebar admin
- Le menu utilisateur expose une option "Connecter mon compte Twitch" (pour les viewers)
- L'extension Twitch peut être générée depuis `/admin/streamer-hub/extension`

### 2.2 Couche Provider

```
┌─────────────────────────────────────────────────────────┐
│                  Streamer Hub (core)                    │
│  Routes admin, persistence, UI, command dispatcher      │
└─────────────────────────┬───────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │   Provider interface  │
              └───────────┬───────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   ┌──────────┐     ┌──────────┐     ┌──────────┐
   │  Twitch  │     │  Owncast │     │ PeerTube │
   │ Phase 1  │     │  futur   │     │  futur   │
   └──────────┘     └──────────┘     └──────────┘
```

L'interface `StreamerProvider` expose :

```typescript
interface StreamerProvider {
  id:    'twitch' | 'owncast' | 'peertube' | 'youtube' | 'kick'
  label: string

  // OAuth flow (streamer)
  getAuthUrl(redirectUri: string, state: string): string
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>
  refreshTokens(refreshToken: string): Promise<OAuthTokens>

  // EventSub / webhooks / polling
  subscribeEvents(token: string, callbackUrl: string): Promise<void>
  unsubscribeEvents(token: string): Promise<void>
  verifyWebhookSignature(req: IncomingRequest): boolean
  parseWebhookEvent(req: IncomingRequest): StreamerEvent | null

  // Chat bridge
  connectChat(token: string, channel: string, onMessage: ChatHandler): ChatConnection
  sendChatMessage(connection: ChatConnection, text: string): Promise<void>

  // Stream metadata
  getStreamInfo(token: string, channel: string): Promise<StreamInfo | null>
  getTopClips(channel: string, count: number): Promise<Clip[]>
}
```

Phase 1 implémente uniquement `TwitchProvider`. Les phases ultérieures peuvent ajouter Owncast / PeerTube / YouTube Live / Kick sans toucher au reste.

### 2.3 Composants concrets (Phase 1)

**Backend (`nodyx-core`)**

- `src/services/streamer/streamerHubService.ts` : orchestration, persistence, dispatch
- `src/services/streamer/providers/twitchProvider.ts` : provider Twitch
- `src/services/streamer/providers/_types.ts` : interface commune
- `src/routes/streamer.ts` : endpoints admin + viewer + webhook EventSub
- `src/services/streamer/chatBridge.ts` : bridge Twitch IRC ↔ Nodyx chat
- `src/services/streamer/obsClient.ts` : connexion OBS WebSocket v5

**Frontend (`nodyx-frontend`)**

- `src/routes/admin/streamer-hub/+page.svelte` : tableau de bord
- `src/routes/admin/streamer-hub/connect/+page.svelte` : flow OAuth Twitch
- `src/routes/admin/streamer-hub/obs/+page.svelte` : Stream Deck web
- `src/routes/admin/streamer-hub/stats/+page.svelte` : stats live + recap
- `src/routes/admin/streamer-hub/extension/+page.svelte` : générateur d'extension
- `src/routes/auth/connect-twitch/+page.svelte` : flow OAuth viewer
- `src/lib/streamer/twitchAlert.ts` : gestion des alertes côté UI

---

## 3. Database schema (migration 078)

```sql
-- ─── Tokens OAuth chiffrés (provider × streamer) ─────────────────────────
CREATE TABLE streamer_oauth_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL CHECK (provider IN ('twitch', 'owncast', 'peertube', 'youtube', 'kick')),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  external_id       TEXT NOT NULL,                          -- Twitch user_id, etc.
  external_login    TEXT NOT NULL,                          -- Twitch login, etc.
  access_token_enc  TEXT NOT NULL,                          -- AES-256-GCM ciphertext
  refresh_token_enc TEXT NOT NULL,
  scopes            TEXT[] NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  is_streamer       BOOLEAN NOT NULL DEFAULT FALSE,         -- TRUE pour le streamer principal, FALSE pour les viewers
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, external_id)
);

CREATE INDEX idx_streamer_oauth_user     ON streamer_oauth_tokens(user_id);
CREATE INDEX idx_streamer_oauth_streamer ON streamer_oauth_tokens(provider, is_streamer) WHERE is_streamer = TRUE;

-- ─── Events temps-réel (follow, sub, raid, bits, etc) ────────────────────
CREATE TABLE streamer_events (
  id           BIGSERIAL PRIMARY KEY,
  provider     TEXT NOT NULL,
  event_type   TEXT NOT NULL,                              -- 'follow', 'subscribe', 'subscription.gift', 'cheer', 'raid', 'poll.begin', 'poll.end', 'stream.online', 'stream.offline'
  external_id  TEXT,                                       -- ID Twitch / Owncast / etc.
  payload      JSONB NOT NULL,                             -- payload complet du provider
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL, -- viewer Nodyx si lié
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ                                 -- NULL si pas encore dispatch
);

CREATE INDEX idx_streamer_events_occurred ON streamer_events(occurred_at DESC);
CREATE INDEX idx_streamer_events_type     ON streamer_events(event_type, occurred_at DESC);

-- ─── Lien viewer Twitch ↔ user Nodyx ────────────────────────────────────
-- (utilisateur déjà inscrit qui lie son compte Twitch en plus)
ALTER TABLE users ADD COLUMN twitch_id    TEXT UNIQUE;
ALTER TABLE users ADD COLUMN twitch_login TEXT;

CREATE INDEX idx_users_twitch ON users(twitch_id) WHERE twitch_id IS NOT NULL;

-- ─── Streams (un par session de stream) ──────────────────────────────────
CREATE TABLE streamer_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT NOT NULL,
  external_id   TEXT NOT NULL,                             -- Twitch stream_id
  thread_id     UUID REFERENCES threads(id) ON DELETE SET NULL,  -- thread auto pour le récap
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ,
  peak_viewers  INTEGER DEFAULT 0,
  total_followers_gained INTEGER DEFAULT 0,
  total_subs_gained      INTEGER DEFAULT 0,
  total_bits             INTEGER DEFAULT 0,
  total_raids_in         INTEGER DEFAULT 0,
  category      TEXT,
  title         TEXT
);

CREATE INDEX idx_streamer_sessions_started ON streamer_sessions(started_at DESC);

-- ─── OBS WebSocket configuration (un par instance) ───────────────────────
CREATE TABLE streamer_obs_config (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  ws_url          TEXT,                                          -- ex: ws://localhost:4455
  password_enc    TEXT,                                          -- AES-256-GCM
  scenes_layout   JSONB NOT NULL DEFAULT '[]',                   -- layout du Stream Deck web
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO streamer_obs_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ─── Audit log (étend le pattern de backup_audit_log) ────────────────────
CREATE TABLE streamer_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,                              -- 'connect_twitch', 'disconnect', 'config_obs', 'generate_extension'
  ip_address   INET,
  metadata     JSONB,
  status       TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_streamer_audit_created ON streamer_audit_log(created_at DESC);
```

---

## 4. OAuth Twitch — flow streamer

### 4.1 Scopes minimaux requis

| Scope | Pourquoi |
|---|---|
| `user:read:email` | Identifier le streamer |
| `chat:read` | Lire le chat Twitch (bridge → Nodyx) |
| `chat:edit` | Envoyer messages dans le chat Twitch (bridge ← Nodyx) |
| `channel:read:subscriptions` | Détecter les subs |
| `bits:read` | Détecter les bits |
| `moderator:read:followers` | Détecter les follows (oui, c'est `moderator` dans la nouvelle API EventSub) |
| `clips:edit` | Top clips, raider preview |
| `channel:read:polls` | Recap polls |
| `channel:manage:polls` | Optionnel : créer un poll Twitch depuis Nodyx |

### 4.2 Flow

1. Admin clique **Connecter Twitch** sur `/admin/streamer-hub`
2. Frontend → `GET /api/v1/streamer/twitch/auth` → renvoie l'URL Twitch OAuth
3. Redirect vers `https://id.twitch.tv/oauth2/authorize?...`
4. Twitch redirige vers `https://nodyx.org/api/v1/streamer/twitch/callback?code=...&state=...`
5. Backend valide `state` (CSRF), échange `code` contre `access_token` + `refresh_token`
6. Tokens chiffrés AES-256-GCM avec `STREAMER_OAUTH_KEY` (env), insérés en DB
7. EventSub : abonnement aux events listés section 5
8. Redirect vers `/admin/streamer-hub` avec un toast "Connecté en tant que [login]"

### 4.3 Refresh automatique

Le refresh token Twitch est valide indéfiniment (jusqu'à révocation explicite). Avant chaque appel API, le service vérifie `expires_at` et refresh si nécessaire (avec une marge de 5 min).

---

## 5. EventSub — webhooks Twitch temps-réel

### 5.1 Endpoint

`POST /api/v1/integrations/twitch/eventsub` (public, signature HMAC obligatoire)

Vérification :
- Header `Twitch-Eventsub-Message-Signature` : HMAC-SHA256 du body, signé avec le secret partagé fourni à `subscribeEvents`
- Header `Twitch-Eventsub-Message-Type` : `webhook_callback_verification` / `notification` / `revocation`
- Header `Twitch-Eventsub-Message-Id` : déduplication (cache Redis 24h)

### 5.2 Events souscrits

| Event Twitch | Action Nodyx |
|---|---|
| `channel.follow` (v2) | INSERT `streamer_events`, post dans le chat Nodyx, lien viewer si possible |
| `channel.subscribe` | idem + thread dédié si gros sub |
| `channel.subscription.gift` | idem + accumulation pour anniversaire mensuel |
| `channel.cheer` | idem + leaderboard bits |
| `channel.raid` (incoming) | trigger raider preview (top clips) |
| `channel.raid` (outgoing) | post dans le chat Nodyx |
| `channel.poll.begin` | mirror en poll Nodyx avec `external_id` |
| `channel.poll.end` | met à jour le poll Nodyx |
| `stream.online` | crée un `streamer_sessions` + thread auto-récap |
| `stream.offline` | clôture le `streamer_sessions`, génère le récap |

### 5.3 Flux

```
Twitch                 nodyx.org                Nodyx instance
  │                        │                          │
  │────HMAC POST──────────>│                          │
  │   (event)              │                          │
  │                        │ verify HMAC              │
  │                        │ dedupe                   │
  │                        │ INSERT streamer_events   │
  │                        │ dispatch via Socket.IO   │
  │                        │──────────────────────────>│
  │                        │                          │ post in chat
  │                        │                          │ update store
  │                        │                          │ trigger overlay
```

---

## 6. Chat bridge Twitch IRC ↔ Nodyx

### 6.1 Architecture

Connexion IRC TLS persistante depuis `nodyx-core` vers `irc.chat.twitch.tv:6697`. Authentification avec le `access_token` du streamer (PASS + NICK).

Pour chaque message IRC :
- Parse les badges (BTTV/FFZ/7TV cache + Twitch native CDN)
- Convertit en payload `chat:message` Nodyx
- Émet sur le channel Nodyx dédié `#twitch-chat` (auto-créé)

Pour chaque message Nodyx posté dans `#twitch-chat` :
- Convertit en `PRIVMSG #channel :message`
- Envoie via la connexion IRC

### 6.2 Préservation des badges et emotes

- **Badges Twitch** (sub, mod, vip, premium) : sprite officiel via Helix `/chat/badges/global` + `/chat/badges/channel`
- **Emotes natives Twitch** : URL CDN `https://static-cdn.jtvnw.net/emoticons/v2/{id}/default/dark/2.0`
- **BTTV** : `https://api.betterttv.net/3/cached/users/twitch/{user_id}` + `https://cdn.betterttv.net/emote/{id}/2x.webp`
- **FFZ** : `https://api.frankerfacez.com/v1/room/id/{room_id}` + cache 24h
- **7TV** : `https://7tv.io/v3/users/twitch/{user_id}` + cache 24h

Tous les caches stockés en Redis (`emotes:bttv:channel:{user_id}`, etc., TTL 24h).

### 6.3 Limites techniques

- Twitch IRC : 20 messages / 30 secondes pour un compte non-mod, 100 / 30s pour un mod, 7500 messages / 30s pour un partner. Acceptable pour 95% des cas.
- Si rate-limit hit : queue Redis `streamer:chat:queue` avec backoff exponentiel.

---

## 7. Mapping viewer Twitch ↔ user Nodyx

### 7.1 Trois flows possibles

**Flow A — Viewer existant déjà sur Nodyx, lie son compte Twitch**

1. Sur son profil → "Connecter mon compte Twitch"
2. OAuth Twitch (scope minimal `user:read:email`)
3. Backend récupère `twitch_id` + `twitch_login`, met à jour la row `users`
4. Désormais, ses events Twitch (follow, sub, etc) sont liés à son compte Nodyx → notifs perso, badges affichés

**Flow B — Viewer arrive depuis Twitch, pas encore inscrit sur Nodyx**

1. Sur la page Twitch du streamer, clique le panel d'extension "Rejoindre la communauté de [streamer]"
2. Atterrit sur l'instance Nodyx, écran "Login with Twitch"
3. OAuth Twitch
4. Backend crée un user avec `twitch_id` + `twitch_login` + email Twitch
5. Le viewer est connecté

**Flow C — Viewer existant sur Nodyx (autre login), arrive depuis Twitch**

1. Click panel Twitch → arrive sur Nodyx
2. Login with Twitch → match `twitch_id` existant en DB
3. Login automatique sur le compte Nodyx déjà existant

### 7.2 Sécurité

- Email Twitch comme fallback de matching, mais `twitch_id` est la clé primaire (un user peut changer d'email Twitch sans se faire ré-attribuer un autre compte Nodyx)
- Si un user Nodyx existe avec le même email mais sans `twitch_id`, on propose une fusion avec confirmation explicite
- Audit log de chaque liaison

---

## 8. OBS Stream Deck web

### 8.1 Connexion OBS WebSocket v5

Le streamer :
1. Installe OBS 28+ (built-in WebSocket server v5)
2. Active "WebSocket Server" dans OBS Settings
3. Note le port (4455 par défaut) et le mot de passe généré
4. Configure dans Nodyx `/admin/streamer-hub/obs` :
   - URL : `ws://localhost:4455` (ou IP du PC du streamer)
   - Password : copié depuis OBS

Le frontend Nodyx ouvre une **connexion WebSocket directe depuis le navigateur** vers OBS (pas via le serveur). Avantage : moins de hops, latence minimale, pas de credential côté serveur Nodyx.

Limitation : le navigateur du streamer doit pouvoir joindre OBS. Si OBS tourne sur le PC local, `ws://localhost:4455` fonctionne. Si OBS tourne sur un autre PC, il faut que les ports soient routables.

### 8.2 Actions exposées

Phase 1 minimal :
- Switch scene
- Toggle source visibility (mic, cam, capture)
- Start/stop streaming
- Start/stop recording
- Save replay buffer
- Custom hotkeys mappés

Phase 5 polish :
- Filter toggle (chroma key, color correction, etc.)
- Audio mixer (volume sliders par source)
- Profile / scene collection switch

### 8.3 UI Stream Deck

Grille 5 × 3 (15 boutons) configurable, drag-and-drop. Chaque bouton :
- Label personnalisé
- Icône (emoji, SVG, image upload)
- Action : choix dans un menu déroulant des actions OBS dispo
- Couleur de fond

Layout sauvegardé en `streamer_obs_config.scenes_layout` (JSONB).

---

## 9. Stats live & récap polls

### 9.1 Stats live

À l'événement `stream.online` :
- Création d'un thread auto dans la catégorie "Streams" (auto-créée la 1ère fois)
- Titre : `[Stream] [Date]: [Titre Twitch]`
- Premier post : embed live qui se met à jour toutes les 60s avec :
  - Catégorie Twitch
  - Nombre de viewers actuels
  - Nombre de followers gagnés
  - Nombre de subs gagnés
  - Nombre de raids reçus
  - Top 5 chatters (messages envoyés)
  - Top 5 emotes utilisées

À l'événement `stream.offline` :
- Édition du premier post → version finale (durée totale, peak viewers, etc.)
- Post de récap automatique :

```
🎬 Stream terminé après 4h 23min
👥 Peak: 234 viewers
🆕 +12 followers, +3 subs, +1 raid (Streamer X)
💬 1 247 messages, 47 chatters uniques
🎉 Top emote: KEKW (203 occurrences)
```

### 9.2 Récap polls

Quand un poll Twitch est créé :
- Mirror automatique en poll Nodyx avec `external_id` partagé
- Les votes Nodyx sont fusionnés avec les votes Twitch dans l'affichage
- À la fin du poll : post de récap avec graphique de la répartition

---

## 10. Top clips & raider preview

### 10.1 Commande chat `!topclips`

Quand un message Twitch ou Nodyx contient `!topclips` (et que l'auteur a le droit `moderator+` ou que le streamer l'a activé pour tous) :
- Backend appelle Helix `/clips?broadcaster_id=...&first=5`
- Récupère les 5 top clips de la semaine
- Post un message dans le chat Nodyx avec previews
- Si OBS est connecté : option pour afficher en overlay pendant 30s

### 10.2 Raider preview

Sur `channel.raid` (incoming) :
- Backend détecte le `from_broadcaster_user_id`
- Fetch les top 3 clips de ce raider
- Pop-up dans `/admin/streamer-hub` ou notif live : "🎉 [Raider] arrive avec X viewers ! Afficher leurs top clips ?"
- Si OK : envoi à OBS pour afficher en overlay 30s, en hommage au raider

---

## 11. Twitch Extension generator

### 11.1 Flow

1. Streamer clique **Générer mon extension Twitch** sur `/admin/streamer-hub/extension`
2. Nodyx fournit un template `.zip` avec :
   - `manifest.json` (configuré pour pointer vers l'instance)
   - `panel.html` + `panel.js` : panneau "Rejoindre la communauté de [streamer]"
   - `component.html` + `component.js` : overlay live qui affiche les events temps-réel
   - `config.html` + `config.js` : page de config admin (pas grand chose vu que tout vient de l'instance)
3. Le streamer télécharge le `.zip` et l'upload sur dev.twitch.tv en suivant le tuto fourni
4. Soumission Twitch (peut prendre des semaines pour approval)
5. Une fois approuvée : l'extension est dispo sur sa page Twitch

### 11.2 Pubsub

L'extension utilise **Twitch PubSub** pour recevoir les events de l'instance Nodyx :
- L'instance Nodyx publie un message PubSub via Helix avec un JWT signé
- L'extension côté viewer écoute le pubsub channel
- L'overlay s'anime en temps réel (alerte de follow, sub, raid, etc.)

JWT signé par l'instance avec son secret d'extension (généré au moment de la génération de l'extension).

### 11.3 Marketing intégré

Le panel par défaut affiche :
- Nom de la communauté + avatar
- Lien direct vers l'instance Nodyx
- Footer : "Powered by Nodyx — outils libres pour streamers"

Effet viral : chaque streamer Nodyx qui installe l'extension promeut Nodyx auprès de ses viewers Twitch.

---

## 12. Sécurité

- **Tokens AES-256-GCM** au repos (env var `STREAMER_OAUTH_KEY`, 32 octets aléatoires). Si la clé fuite, les tokens sont compromis ; si la DB fuite, les tokens restent inutilisables.
- **HMAC SHA-256** sur les EventSub webhooks. Twitch signe avec un secret partagé fourni à `subscribeEvents`. Nodyx vérifie avant de traiter.
- **Déduplication** : `Twitch-Eventsub-Message-Id` cache Redis 24h, évite les doublons en cas de retry Twitch.
- **Rate limit** sur tous les endpoints admin (déjà géré par le middleware `rateLimit` existant).
- **Audit log** sur les actions sensibles (`connect_twitch`, `disconnect`, `config_obs`, `generate_extension`). Pattern identique à `backup_audit_log`.
- **CORS** strict sur l'endpoint EventSub (origine Twitch only via header). En vérité Twitch vient avec son propre `User-Agent`, mais on ne se base que sur la signature HMAC.
- **OBS WebSocket password** chiffré côté serveur (mais utilisé dans le navigateur du streamer après déchiffrement à la session admin). Stratégie acceptable parce que le password ne quitte pas la machine du streamer après ouverture de la session.
- **Twitch Extension JWT secret** : généré à la première génération, stocké chiffré. Permet à l'instance de signer les messages PubSub.

---

## 13. Phases d'implémentation

| Phase | Livrable | Effort | Valeur |
|---|---|---|---|
| **1 — Foundations Twitch** | OAuth Twitch streamer, EventSub (follow / sub / raid / bits / poll / stream), feed activité dans le chat Nodyx, `users.twitch_id`, OAuth viewer | 2-3 j | 🔥 Déjà utilisable comme alerte streamer |
| **2 — Chat unifié Twitch ↔ Nodyx** | Bridge IRC bidirectionnel, badges Twitch + BTTV/FFZ/7TV emotes, channel `#twitch-chat` auto | 3-4 j | 🔥 Remplace Streamer.bot pour 90% des cas |
| **3 — OBS Stream Deck web** | Connexion OBS WebSocket v5 depuis le navigateur, grille drag-and-drop, actions essentielles | 4-5 j | 🔥 Remplace Stream Deck Elgato (~150€) |
| **4 — Stats live + récap polls** | Thread auto-update, récap auto en fin de stream, mirror polls Twitch | 3-4 j | 🔥 Remplace une partie de StreamElements |
| **5 — Top clips, raider preview, Twitch Extension** | Commandes `!topclips`, raider preview overlay, générateur d'extension Twitch | 1-2 sem | 🔥 Effet viral |

**Phase 1 seule** rend déjà Nodyx utilisable comme remplaçant de Streamlabs/StreamElements pour les alertes basiques. Chaque phase ajoutée empile de la valeur sans casser ce qui précède.

---

## 14. Fichiers à créer / modifier

**Backend** :
- `nodyx-core/src/migrations/078_streamer_hub.sql` (nouveau)
- `nodyx-core/src/services/streamer/streamerHubService.ts` (nouveau)
- `nodyx-core/src/services/streamer/providers/twitchProvider.ts` (nouveau)
- `nodyx-core/src/services/streamer/providers/_types.ts` (nouveau)
- `nodyx-core/src/services/streamer/chatBridge.ts` (Phase 2)
- `nodyx-core/src/services/streamer/obsClient.ts` (Phase 3)
- `nodyx-core/src/routes/streamer.ts` (nouveau)
- `nodyx-core/src/index.ts` (register routes)

**Frontend** :
- `nodyx-frontend/src/routes/admin/streamer-hub/+page.svelte`
- `nodyx-frontend/src/routes/admin/streamer-hub/connect/+page.svelte`
- `nodyx-frontend/src/routes/admin/streamer-hub/obs/+page.svelte`
- `nodyx-frontend/src/routes/admin/streamer-hub/stats/+page.svelte`
- `nodyx-frontend/src/routes/admin/streamer-hub/extension/+page.svelte`
- `nodyx-frontend/src/routes/auth/connect-twitch/+page.svelte`
- `nodyx-frontend/src/lib/streamer/twitchAlert.ts`

**Docs** :
- `docs/admin/streamer-hub.md` (FR + EN)

**Infra** :
- `install.sh` : générer `STREAMER_OAUTH_KEY` au setup
- `nodyx-core/.env.example` : ajouter les vars

---

## 15. Risques & questions ouvertes

1. **Twitch peut deprecate des events sans préavis.** Mitigation : versionnage de la couche provider, fallback sur polling Helix si EventSub down. Monitoring : alertes admin si pas d'event reçu pendant 1h alors que `stream.online`.

2. **Twitch IRC peut devenir read-only un jour** (rumeurs). Mitigation : migration prévue vers EventSub Chat (en preview chez Twitch). Refactor estimé à 1-2 jours.

3. **OBS WebSocket v5 nécessite OBS ≥ 28.** Mitigation : message clair dans la doc, version check à la connexion.

4. **Twitch Extension submission peut être refusée** ou prendre des semaines. Mitigation : la spec ne dépend pas de l'extension pour fonctionner. C'est un bonus marketing, pas un bloquant.

5. **Multi-streamer ?** Décidé : NON. Une instance = un streamer principal + ses mods (en lecture). Si plusieurs streamers veulent collaborer, ils ouvrent chacun leur instance Nodyx et utilisent `nodyx-relay` pour se fédérer.

6. **Modération automatique côté Twitch chat (bannir, timeout, etc) depuis Nodyx ?** Hors scope Phase 1-5. Phase 6 potentielle, scope à définir.

7. **Intégration des autres providers (Owncast, PeerTube, YouTube Live, Kick) ?** Architecture prête (interface `StreamerProvider`), implémentations à faire après Phase 5 selon demande communauté. Owncast probablement en premier (libre, self-hosted, philosophie alignée).

8. **OBS via cloud (depuis un autre PC, pas localhost) ?** Hors scope Phase 1-5. La complexité explose (NAT traversal, proxy, etc). Phase 6+ si demandé.

---

## 16. V2 — Évolutions futures (hors scope V1)

À mentionner pour ne pas se peindre dans un coin :

- **Owncast / PeerTube / YouTube Live / Kick providers** : architecture prête, implémentation à la demande
- **TipeeeStream / Twitch Bits payouts** : agrégation des revenus en un seul tableau de bord
- **Chat moderation tools** : bannir, timeout, supprimer un message Twitch depuis Nodyx
- **Bot commandes custom** : `!discord`, `!followage`, `!uptime`, etc, configurables depuis Nodyx
- **Soundboard** : déclencher des sons OBS depuis le chat (commandes ou clic)
- **Donor wall** : panneau auto-update des derniers dons / subs / bits
- **Loyalty points (Streamlabs Points clone)** : système de fidélité Nodyx-natif
- **Extension hub Nodyx** : marketplace d'overlays / panels prêts à l'emploi
- **Auto-clip** : enregistre un clip à chaque event majeur (sub, raid, gros bits)
- **Webhook outgoing** : envoyer les events vers Zapier / IFTTT / autres
- **Multi-language streamer team** : un streamer + un co-host dans une autre langue, chats séparés affichés côte à côte

---

## 17. Décision finale demandée

OK pour partir sur cette spec ?

Si oui, je commence par la Phase 1 (Foundations Twitch) sur la branche `feat/streamer-hub-phase-1`, en suivant le même pattern que pour le backup system (branche dédiée, smoke test sur prod avant merge, mode maintenance auto-actif si besoin de toucher à des données critiques).

Si tu veux ajuster quelque chose : scopes Twitch en plus/en moins, autre ordre des phases, autre découpage…
