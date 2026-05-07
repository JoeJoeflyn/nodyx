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

## 6. Chat bridge Twitch ↔ Nodyx

### 6.1 Architecture (EventSub Chat, pas IRC)

Twitch a poussé en GA fin 2024 deux APIs qui rendent IRC obsolète pour notre cas d'usage :
- **EventSub Chat** (`channel.chat.message`) : webhook qui pousse chaque message du chat vers nous, dans le même pipeline que les autres events (subs, follows, etc.)
- **Helix Send Chat Message** (`POST /chat/messages`) : envoie un message dans le chat depuis le compte streamer

Donc **zéro connexion IRC** à maintenir. Le bridge devient un simple flux de webhooks et de POST HTTP, dans la même couche que tout le reste.

```
Inbound  : Twitch chat → EventSub channel.chat.message webhook → Nodyx chat #twitch-chat
Outbound : Message Nodyx dans #twitch-chat → POST /chat/messages Helix → Twitch chat
```

Les messages reçus arrivent dans `streamer_events` avec `event_type = 'chat.message'` et un `payload` contenant `{ broadcaster_user_id, chatter_user_id, message, badges, fragments... }`.

### 6.2 Channel Nodyx dédié

Un channel `#twitch-chat` est auto-créé à la première connexion Twitch. Il est read-write par défaut pour tous les membres de l'instance. Toute écriture dans ce channel est relayée vers le chat Twitch.

Mode "lecture seule pour les non-streamers" optionnel via la config admin.

### 6.3 Préservation des badges et emotes

EventSub Chat fournit déjà les `badges` et `fragments` (avec emote IDs) dans le payload. On enrichit côté Nodyx avec :

- **Badges Twitch** (sub, mod, vip, premium) : sprite officiel via Helix `/chat/badges/global` + `/chat/badges/channel`, cachés en Redis 24h
- **Emotes natives Twitch** : URL CDN `https://static-cdn.jtvnw.net/emoticons/v2/{id}/default/dark/2.0`
- **BTTV** : `https://api.betterttv.net/3/cached/users/twitch/{user_id}` + `https://cdn.betterttv.net/emote/{id}/2x.webp`
- **FFZ** : `https://api.frankerfacez.com/v1/room/id/{room_id}` + cache 24h
- **7TV** : `https://7tv.io/v3/users/twitch/{user_id}` + cache 24h

Tous les caches stockés en Redis (`emotes:bttv:channel:{user_id}`, etc., TTL 24h).

### 6.4 Garde-fou : check stream live avant send

Avant chaque `POST /chat/messages` outbound, on vérifie que `streamer_sessions` a une session ouverte pour ce streamer (`ended_at IS NULL`). Sinon, on n'envoie pas (un message dans le chat d'un stream offline est inutile et perçu comme spam par les viewers qui se connectent à la prochaine session).

Mode **"test"** : un toggle admin bypasse ce check pour permettre au streamer de tester l'envoi à froid.

### 6.5 Limites techniques

- **Helix Send Chat Message** : limite de 100 req/min pour un compte régulier, 1500 req/min pour un compte affilié/partenaire. Largement suffisant.
- **EventSub Chat** : pas de limite côté reception, c'est Twitch qui pousse.
- Si rate-limit hit côté send : queue Redis `streamer:chat:send_queue` avec backoff exponentiel + alerte admin si la queue dépasse 50 messages en attente.

### 6.6 Pourquoi pas IRC

IRC reste fonctionnel à la date de cette spec, mais Twitch a clairement signalé sa volonté de pousser EventSub Chat comme remplacement. Choisir IRC dès Phase 2 = se créer une dette technique pour un refactor inévitable. Choisir EventSub Chat = aligné avec la direction Twitch, code plus simple, pipeline unifié avec le reste des events.

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

### 8.1 Topologies supportées

Trois cas réels chez les streamers :

| Topologie | Cas d'usage | Configuration Nodyx |
|---|---|---|
| **A. PC unique** | Streamer débutant, configurateur OBS sur la même machine que le navigateur | `ws://localhost:4455` |
| **B. Multi-PC LAN** | Streamer sérieux : PC gaming + PC streaming + Pi pour OBS, tous sur le même réseau | `ws://192.168.X.Y:4455` (IP locale du PC OBS) |
| **C. Distant via tunnel** | Stream à distance, PC OBS chez soi, navigateur en déplacement | Tunnel utilisateur (Tailscale, Cloudflare Tunnel, headscale, …) qui expose le PC OBS sur l'internet, puis `wss://obs.tunnel.example:4455` |

**Phase 3 (initiale)** couvre A et B en mode **navigateur-direct** : le frontend Nodyx ouvre une connexion WebSocket directe vers OBS. Avantages :
- Latence minimale (pas de hop serveur)
- Aucun credential OBS sur le serveur Nodyx
- Marche en LAN sans aucune config réseau supplémentaire

**Phase 6+ (futur)** ajoute un mode **proxy serveur** pour le cas C sans tunnel utilisateur :
- Credentials OBS chiffrés côté serveur Nodyx
- Le serveur Nodyx maintient la connexion OBS
- Le navigateur parle au serveur Nodyx via Socket.IO
- Latence +30-80ms acceptable, fonctionne depuis n'importe où

### 8.2 Configuration

Le streamer :
1. Installe OBS ≥ 28 (WebSocket server v5 built-in)
2. Active "WebSocket Server" dans OBS Settings → Tools → WebSocket Server Settings
3. Note le port (4455 par défaut) et le mot de passe généré
4. Configure dans Nodyx `/admin/streamer-hub/obs` :
   - **URL** : `ws://localhost:4455` (cas A) ou `ws://<IP-LAN>:4455` (cas B). En cas C, l'URL du tunnel
   - **Password** : copié depuis OBS

Le frontend teste la connexion immédiatement après save (handshake WebSocket v5 + auth challenge). Feedback clair : ✓ "Connecté à OBS [version]" ou ✗ avec le message d'erreur exact (timeout, mauvais password, port fermé).

### 8.3 Doc tunnel pour le cas C

`docs/admin/streamer-hub-obs-tunnel.md` (FR + EN) liste 3 setups éprouvés :
- **Tailscale** (le plus simple, gratuit jusqu'à 100 devices) : configuration en 5 commandes
- **Cloudflare Tunnel** (gratuit, requiert un domaine sur CF) : `cloudflared tunnel`
- **headscale** (auto-hébergé Tailscale) : pour les puristes self-hosted

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

### 9.1 Modèle "1 thread par mois, 1 post par stream"

Plutôt que créer un thread par stream (catastrophe de pollution pour un streamer quotidien : 30 threads/mois, recherche cassée, pagination ingérable), on consolide :

- **1 thread mensuel** auto-créé au premier stream du mois, dans la catégorie "Streams" (auto-créée la 1ère fois)
- **Titre** : `[Streams] Mai 2026`
- **Chaque stream du mois** = un post dans ce thread, formaté en récap consolidé
- **Stream en cours** = le post du jour en mode "live" qui se met à jour en temps réel
- **Stream terminé** = le post passe en version finale (totaux figés)

Bénéfices :
- Lisibilité : on voit l'historique d'un mois en un coup d'œil
- Recherche : `Mai 2026` retourne 1 thread, pas 30
- Archive automatique : les threads des mois passés s'accumulent proprement, sans intervention manuelle
- Engagement : les viewers peuvent commenter chaque stream dans son post, sans noyer le thread

### 9.2 Stats live (stream en cours)

À l'événement `stream.online` :
- Si pas de thread `[Streams] [Mois Année]` pour le mois en cours → création
- Création d'un nouveau post dans ce thread, marqué `live = true`
- Le post contient un embed temps réel mis à jour toutes les 60s :
  - Titre Twitch + catégorie
  - Nombre de viewers actuels
  - Followers / subs / raids gagnés depuis le début de la session
  - Top 5 chatters (messages envoyés)
  - Top 5 emotes utilisées
  - Lien vers le replay (rempli à `stream.offline`)

À l'événement `stream.offline` :
- Le post passe en version finale (totaux figés, plus de mise à jour)
- Post de récap consolidé :

```
🎬 Stream du 7 mai 2026 — 4h 23min
🎮 Catégorie : Just Chatting
👥 Peak : 234 viewers (moy. 187)
🆕 +12 followers, +3 subs, +1 raid (Streamer X arrive avec 89 viewers)
💬 1 247 messages, 47 chatters uniques
🎉 Top emote : KEKW (203 occurrences)
🔗 [Replay sur Twitch](...)
```

### 9.3 Récap mensuel

Le 1er de chaque mois à 00:00 UTC, un dernier post est ajouté au thread du mois précédent : récap mensuel agrégé (total heures streamées, croissance followers, top events, etc.). Puis le thread est verrouillé (lectures OK, plus d'écriture).

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

### 10.2 Rate-limit anti-flood

Toutes les commandes chat (`!topclips`, `!followage`, `!uptime`, …) sont **rate-limitées par utilisateur** via Redis :
- Cooldown global par commande : 30 s
- Cooldown spécifique par couple (utilisateur, commande) : 60 s
- Si flood détecté (5 hits du cooldown en 1 min) : timeout 5 min de l'utilisateur sur les commandes (le chat normal reste ouvert)
- Bypass : le streamer + ses mods n'ont aucun cooldown

Implémentation : clé Redis `streamer:cmd:{cmd}:{user_id}` avec TTL = cooldown. Présence de la clé = on ignore la commande silencieusement (pas de toast, pas de spam de "tu dois attendre").

### 10.3 Liste des commandes chat (Phase 5)

| Commande | Action | Cooldown |
|---|---|---|
| `!topclips` | Top 5 clips de la semaine | 30 s |
| `!uptime` | Durée du stream en cours | 10 s |
| `!followage [@user]` | Depuis quand `user` follow | 30 s |
| `!so @user` | Shoutout (post un récap du dernier stream de `user`, mods only) | 30 s |
| `!discord` ou `!nodyx` | Lien vers l'instance Nodyx | 60 s |
| `!commands` | Liste les commandes dispo | 30 s |

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
| **0 — Spike technique** | OAuth Twitch streamer + 1 webhook EventSub qui logge l'event dans la console + refresh token. Aucune UI, aucune persistence, aucun chat. **Lever les doutes du flow OAuth/HMAC/refresh avant tout engagement de Phase 1.** | 1-2 j | Validation de faisabilité |
| **1 — Foundations Twitch** | OAuth Twitch streamer (+ stockage chiffré), EventSub complet (follow / sub / raid / bits / poll / stream), feed activité dans le chat Nodyx, `users.twitch_id`, OAuth viewer (3 flows) | 2-3 j | 🔥 Déjà utilisable comme alerte streamer |
| **2 — Chat unifié Twitch ↔ Nodyx** | Bridge **EventSub Chat (in) + Helix Send Chat Message (out)**, badges Twitch + BTTV/FFZ/7TV emotes, channel `#twitch-chat` auto, check stream live avant send | 3-4 j | 🔥 Remplace Streamer.bot pour 90% des cas |
| **3 — OBS Stream Deck web** | Connexion OBS WebSocket v5 depuis le navigateur (LAN + tunnel), grille drag-and-drop, actions essentielles, doc tunnel pour multi-PC | 4-5 j | 🔥 Remplace Stream Deck Elgato (~150€) |
| **4 — Stats live + récap polls** | Thread mensuel + post-par-stream auto-update, récap auto en fin de stream + récap mensuel le 1er de chaque mois, mirror polls Twitch | 3-4 j | 🔥 Remplace une partie de StreamElements |
| **5 — Top clips, raider preview, commandes chat, Twitch Extension** | Commandes `!topclips` `!uptime` `!followage` `!so` `!commands` (avec rate-limit), raider preview overlay, générateur d'extension Twitch | 1-2 sem | 🔥 Effet viral |

**Phase 0 (Spike)** est OBLIGATOIRE avant Phase 1. C'est un proof-of-concept jeté qui valide que le flow OAuth Twitch + signature HMAC EventSub + refresh tokens fonctionne bout en bout dans notre environnement Caddy + nodyx-core. Si la Phase 0 révèle un blocage technique majeur (cas tordu CORS, problème de redirect URI multi-instance, etc.), on l'apprend en 1 jour, pas en plein milieu de la Phase 1. Le code de Phase 0 est jeté ou intégré, peu importe — l'objectif est l'apprentissage.

**Phase 1 seule** (après spike validé) rend déjà Nodyx utilisable comme remplaçant de Streamlabs/StreamElements pour les alertes basiques. Chaque phase ajoutée empile de la valeur sans casser ce qui précède.

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

OK pour partir sur cette spec, version 2 (post-revue Pokled) ?

Si oui, on attaque dans cet ordre :
1. **Phase 0 — Spike technique** sur la branche `feat/streamer-hub-spike`. 1 à 2 jours. Objectif : OAuth Twitch streamer + 1 webhook EventSub bout-en-bout, dans notre topologie Caddy + nodyx-core. Pas d'UI, pas de DB, pas de chat. On loggue dans la console et on valide. Si OK : merge `main`, on garde le code minimal de validation comme base. Si KO : on apprend, on adapte la spec, on relance.
2. **Phase 1 — Foundations Twitch** sur la branche `feat/streamer-hub-phase-1`, en suivant le pattern backup system : branche dédiée, smoke test sur prod avant merge, mode maintenance auto-actif si besoin de toucher à des données critiques.

Changements depuis v1 (revue Pokled) :
- Section 6 : abandon d'IRC, passage à EventSub Chat + Helix Send Chat Message
- Section 8 : ajout des topologies multi-PC (LAN + tunnel) + plan Phase 6+ pour proxy serveur
- Section 9 : threads consolidés (1 par mois, 1 post par stream) au lieu d'1 thread par stream
- Section 10 : rate-limit anti-flood sur les commandes chat + liste des commandes Phase 5
- Section 13 : ajout de la Phase 0 (Spike technique) obligatoire avant Phase 1
- Section 6.4 : check stream live avant chaque send chat outbound

Si tu veux ajuster encore : scopes Twitch en plus/en moins, autre ordre des phases, autre découpage…
