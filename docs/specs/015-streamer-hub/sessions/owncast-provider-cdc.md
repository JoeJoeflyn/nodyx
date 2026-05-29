# Streamer Hub — Owncast provider : Cahier des charges

**Référence spec parente** : `docs/specs/015-streamer-hub/SPEC.MD` v2.4 (§2.2 couche provider, §15.7, §16 V2)
**Branche cible** : `spec/owncast-provider` (CDC) puis `feat/streamer-owncast` (code)
**Migration** : 097 (prochaine dispo)
**Statut** : draft, en attente d'arbitrage Jonathan (notamment §4 : choix d'architecture)

---

## 0. Pourquoi Owncast en premier

Owncast est le provider non-Twitch le plus aligné avec Nodyx : libre (AGPL-like), self-hosted, zéro silo, zéro GAFAM. C'est le candidat naturel pour prouver que le Streamer Hub n'est pas piégé dans l'écosystème Twitch. C'est aussi le plus simple techniquement (pas d'OAuth, pas de review d'app).

## 1. Constat de départ : l'interface actuelle est 100% Twitch

L'interface `StreamerProvider` (`providers/_types.ts`) est modelée sur Twitch et **ne mappe pas** sur Owncast :

| Méthode interface | Modèle | Owncast |
|---|---|---|
| `buildAuthorizeUrl` / `exchangeCode` / `refreshTokens` | OAuth2 | n/a (pas d'OAuth) |
| `getAppAccessToken` | client_credentials Twitch | n/a |
| `createEventSubscription(hmacSecret)` / `listEventSubscriptions` | EventSub push signé HMAC | n/a (webhooks Owncast non signés) |
| `getCurrentUser` | Helix `/users` | n/a (c'est ton propre serveur) |

23 des 27 fichiers du service streamer référencent "twitch" en dur. **Ajouter Owncast n'est pas un drop-in derrière l'interface existante.**

## 2. Ce qu'Owncast expose réellement (API vérifiée)

**Auth** : aucun OAuth. Le streamer crée un *access token* dans l'admin Owncast (Integrations → Access Tokens) avec les scopes `CAN_SEND_MESSAGES` + `CAN_SEND_SYSTEM_MESSAGES`. Token utilisé en `Authorization: Bearer` sur les endpoints `/api/integrations/...`.

**Sortie (Nodyx → Owncast)** :
- `POST {base}/api/integrations/chat/send` body `{ "body": "msg" }` — message au nom de l'intégration
- `POST {base}/api/integrations/chat/system` body `{ "body": "msg" }` — message système

**Entrée (Owncast → Nodyx)** : webhooks configurés dans l'admin Owncast (Integrations → Webhooks). Le streamer y colle une URL et coche des events. Payload POST : `{ "type": "...", "eventData": {...}, "timestamp": "..." }`. Events disponibles :
- `STREAM_STARTED`, `STREAM_STOPPED`, `STREAM_TITLE_UPDATED`
- `CHAT` (message chat), `USER_JOINED`, `NAME_CHANGE`, `VISIBILITY-UPDATE`

**Statut public** (pas d'auth) : `GET {base}/api/status` → `{ online, viewerCount, lastConnectTime, streamTitle, ... }`. Utile en fallback/polling et pour le viewer count.

**Limite de sécurité connue** : Owncast **ne signe pas** ses webhooks (pas de HMAC natif comme Twitch EventSub). Voir §6.

## 3. Capacités : Owncast = sous-ensemble du hub

| Feature hub | Source Twitch | Source Owncast |
|---|---|---|
| Lifecycle stream online/offline | `stream.online/offline` | `STREAM_STARTED/STOPPED` ✅ |
| Chat in/out | EventSub Chat + Helix | webhook `CHAT` + `/integrations/chat/send` ✅ |
| Viewer count | Helix | `/api/status` ✅ |
| Titre stream | Helix | `STREAM_TITLE_UPDATED` ✅ |
| Follows / subs / gifts / bits | EventSub | ❌ n'existe pas |
| Raids | EventSub | ❌ |
| Polls / prédictions | EventSub | ❌ |
| Clips | Helix | ❌ |
| Channel points | EventSub | ❌ |

**Conséquence UI** : alert box (sub/follow), goal bar (subs/bits), leaderboard (bits), channel points, raider preview, clips player **n'ont aucune donnée** côté Owncast. L'UI et les overlays doivent être tolérants à un provider qui ne fournit pas tel event (gating par capacité), sinon on affiche des features mortes.

## 4. DÉCISION À ARBITRER : architecture (A vs B)

C'est le point pivot. Les deux options livrent le même Owncast V1 fonctionnel (chat + lifecycle + viewer count), mais le coût et la dette diffèrent.

### Option A — Refonte capability-based (propre, pérenne)

Casser `StreamerProvider` en briques optionnelles :

```ts
interface ProviderDescriptor {
  id: ProviderId
  label: string
  auth: { kind: 'oauth2'; ... } | { kind: 'access_token'; ... }
  ingestion: { kind: 'eventsub_push' } | { kind: 'webhook_push' } | { kind: 'poll' }
  capabilities: Set<Capability>   // chat_in, chat_out, lifecycle, follows, subs, bits, raids, polls, clips, viewer_count, ...
  normalizeEvent(raw): StreamerEvent | null   // → forme commune déjà en DB
}
```

Le dispatcher, les onglets admin et les overlays lisent `capabilities` pour s'afficher/se masquer.

- **Coût** : touche le code Twitch SANCTUAIRE (les 23 fichiers). 3-4 sessions. Tests de non-régression Twitch obligatoires avant merge.
- **Risque** : régression sur le path Twitch qui tourne en prod.
- **Bénéfice** : PeerTube / YouTube / Kick deviennent de vrais drop-ins ensuite. Source unique de vérité "qui supporte quoi".

### Option B — Chemin Owncast parallèle (rapide, isolé)

Laisser Twitch intact. Nouveau module `services/streamer/owncast/` branché sur les **tables partagées** (`streamer_events` avec `provider='owncast'`, `streamer_sessions`). Réutilise `crypto.ts` (AES-GCM HKDF déjà livré) et le pattern endpoint nonce.

- **Coût** : 1.5-2 sessions. Un peu de duplication (2e path d'ingestion, 2e path d'envoi chat).
- **Risque** : quasi nul sur Twitch (zéro touche).
- **Bénéfice** : Owncast chat+lifecycle livrable vite.
- **Dette** : au 3e provider, soit on répète le pattern parallèle (N modules), soit on fait enfin la refonte A.

### Recommandation

**B maintenant, avec deux extractions cheap qui préparent A** :
1. Une map centralisée `PROVIDER_CAPABILITIES: Record<ProviderId, Set<Capability>>` que l'UI lit pour gater les features (évite les overlays morts). Coût : faible.
2. Une fonction `normalizeToStreamerEvent(provider, raw)` unique pour ne pas dupliquer la logique d'insert.

Rationale identique à §12.6 de la spec : on fait la refonte structurelle (A) quand il y a ≥ 2 providers non-Twitch qui la justifient, pas avant. Tant qu'Owncast est seul, B livre la valeur sans risquer le SANCTUAIRE.

> Jonathan tranche A / B / hybride avant tout code.

## 5. Périmètre Owncast V1 (sous réserve du choix §4)

**Dans le scope** :
1. Config admin : base URL + access token (chiffré au repos), test de connexion (`GET /api/status`), génération de l'URL webhook nonce à coller dans Owncast.
2. Ingestion webhook : `STREAM_STARTED` → INSERT `streamer_sessions` + post `#streamer-events`. `STREAM_STOPPED` → clôture session. `CHAT` → relai dans le channel chat Nodyx.
3. Chat bridge sortant : message Nodyx → `POST /api/integrations/chat/send`.
4. Viewer count via `/api/status` (poll léger ou STREAM events).
5. Gating UI : les features sans source Owncast sont masquées/désactivées quand le provider actif est Owncast.

**Hors-scope V1 (explicite)** :
- PeerTube / YouTube / Kick (providers suivants).
- Tout overlay qui dépend de follows/subs/bits/raids/polls/clips côté Owncast.
- Federation ActivityPub d'Owncast.
- Admin API Owncast (`/api/admin/...`, HTTP Basic) : pas nécessaire pour V1.
- Multi-provider simultané (Twitch ET Owncast actifs en même temps) : à décider en §8.

## 6. Sécurité (webhooks non signés Owncast)

Owncast ne signe pas ses webhooks. Mesures de compensation :
1. **Nonce dans l'URL** : `POST /api/v1/integrations/owncast/{nonce}` où `{nonce}` = 32 octets base64url stockés en DB. Réutilise le pattern Twitch EventSub (§5.1 spec). Un nonce inconnu = 404 silencieux.
2. **Secret partagé optionnel** : si une version d'Owncast expose un header de signature, on le valide (à vérifier au moment du code). Sinon, on documente la limite.
3. **Filtrage source** : optionnel, IP allowlist de l'instance Owncast du streamer (config admin).
4. **Token Owncast chiffré au repos** : AES-256-GCM HKDF via `crypto.ts` existant, mêmes colonnes salt/iv/tag/kver.
5. **Audit log** : réutilise `streamer_audit_log` (actions `owncast_config`, `owncast_webhook_received`, `owncast_chat_send`).

## 7. DB (migration 097, à confirmer après §4)

Option B → nouvelle table dédiée :

```sql
CREATE TABLE streamer_owncast_config (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  base_url        TEXT,
  token_enc       BYTEA, token_salt BYTEA, token_iv BYTEA, token_tag BYTEA, token_kver INTEGER DEFAULT 1,
  webhook_nonce   TEXT UNIQUE,
  ip_allowlist    TEXT[],
  last_seen_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO streamer_owncast_config (id) VALUES (1) ON CONFLICT DO NOTHING;
```

`streamer_events` et `streamer_sessions` acceptent déjà `provider TEXT` → aucune modif nécessaire, juste `provider='owncast'`.

## 8. Questions ouvertes (à trancher avec Jonathan)

1. **Archi A / B / hybride** (§4) — bloquant.
2. **Twitch ET Owncast simultanés ?** Ou un seul provider "actif" par instance à la fois ? (cohérent avec "une instance = un streamer", mais un streamer peut multicaster Twitch+Owncast).
3. **Channel chat** : `#owncast-chat` séparé, ou fusion dans `#twitch-chat` renommé `#stream-chat` si multi-provider ?
4. **Header de signature webhook Owncast** : à vérifier sur la version Owncast cible au moment du code (la doc historique dit non signé).
5. **Viewer count** : poll `/api/status` toutes les 30-60s, ou se contenter des STREAM events ? (poll = charge réseau légère mais data fraîche).

## 9. Modules à créer (Option B)

**Backend** :
- `services/streamer/owncast/owncastConfig.ts` : CRUD config + test connexion + chiffrement token
- `services/streamer/owncast/owncastWebhook.ts` : parse + dispatch des events entrants
- `services/streamer/owncast/owncastChat.ts` : envoi sortant
- `services/streamer/providerCapabilities.ts` : map capacités (partagé, prépare A)
- `routes/streamer.ts` : endpoints config admin + `routes/integrations` : webhook `/owncast/{nonce}`
- `migrations/097_streamer_owncast.sql`

**Frontend** :
- Onglet/section Owncast dans `/admin/streamer-hub` (config tab) : base URL, token, bouton test, URL webhook à copier + instructions
- Gating des features par capacité provider

## 10. Tests (règle test-first modules critiques)

Dans la même session que le code :
- `owncast-webhook.test.ts` : parse `STREAM_STARTED/STOPPED/CHAT`, nonce inconnu → 404, lifecycle session.
- `owncast-chat.test.ts` : envoi sortant, gestion erreur token invalide.
- `owncast-crypto.test.ts` : token chiffré/déchiffré, test négatif (mauvaise clé → échec).
- Non-régression : si Option A, suite Twitch existante doit rester 100% verte avant merge.

## 11. Critère d'acceptation V1

Sur une instance Nodyx + un Owncast de test :
1. Admin colle base URL + token → "✓ Connecté à Owncast [version]".
2. Admin colle l'URL webhook dans Owncast, lance un stream → `#streamer-events` reçoit "🔴 Stream démarré", `streamer_sessions` a une ligne ouverte.
3. Un message dans le chat Owncast apparaît dans le channel chat Nodyx.
4. Un message Nodyx dans ce channel apparaît dans le chat Owncast.
5. Stream arrêté → session clôturée, message "⚫ Stream terminé".
6. Les onglets/overlays Twitch-only sont masqués quand Owncast est le provider actif.
7. `npm run build` + `npm test` verts.
