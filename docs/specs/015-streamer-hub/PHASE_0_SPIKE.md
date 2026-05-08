# Streamer Hub - Phase 0 Spike

Code scaffold validant le flow Twitch OAuth + EventSub bout-en-bout, avant tout engagement Phase 1. Voir [SPEC.MD](SPEC.MD) section 13 et 15.bis.

## Objectif

Lever 5 points GO / NO-GO listés en §15.bis avant d'écrire la Phase 1 :

1. **EventSub Chat sans review Twitch** : `channel.chat.message` accessible avec une app fraîche ?
2. **`clips:read` au lieu de `clips:edit`** : la lecture de top clips marche-t-elle avec le scope minimal ?
3. **Scopes pour `!so @user`** : Helix `GET /channels?broadcaster_id=...` accessible avec App Token ?
4. **Hosting Extension Twitch HTTPS** : nodyx.org self-hosted éligible à la submission ?
5. **TTL queue chat outbound** : pattern timeout + purge validé empiriquement ?

Le spike ne valide directement que les points 1, 3 et partie de 2. Les points 4 et 5 viendront en revue manuelle plus tard.

## Architecture du spike

```
nodyx-core/src/spike/streamer/
├── crypto.ts          AES-256-GCM + HKDF (master + sel par row)
├── store.ts           Tokens in-memory, state CSRF en Redis (jeté au restart)
├── twitchClient.ts    Wrapper Helix : exchangeCode, refresh, getUser, EventSub subscribe
├── oauth.ts           Plugin Fastify : /auth, /callback, /refresh, /me
├── eventsub.ts        Plugin Fastify : /eventsub/:nonce + HMAC verify + dedupe
└── index.ts           Plugin parent qui register les deux scopes
```

Activé uniquement si `STREAMER_SPIKE_ENABLED=1` dans le `.env`. Sinon : aucune route enregistrée, aucun import exécuté, zéro impact sur le reste de nodyx-core.

Tests négatifs de chiffrement : `nodyx-core/src/tests/streamer-spike-crypto.test.ts` (10 tests, garantissent qu'altérer master / sel / IV / tag / ciphertext fait échouer le déchiffrement).

## Setup

### 1. Créer une App Twitch

Sur [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) :

| Champ | Valeur |
|---|---|
| Nom | `Nodyx Streamer Hub` (ou autre, doit être unique sur Twitch) |
| OAuth Redirect URLs | `https://nodyx.org/api/v1/streamer/twitch/callback` |
| Category | `Website Integration` |
| Type de client | `Confidentiel` |

Puis copie le `Client ID` et génère un `Client Secret`.

### 2. Générer la master key de chiffrement

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Garde cette valeur dans un coffre (1Password / pass / Bitwarden). Si tu la perds, tous les tokens chiffrés sont irrécupérables.

### 3. Variables d'environnement

Ajouter dans `nodyx-core/.env` (prod : `/var/www/nexus/nodyx-core/.env`) :

```bash
TWITCH_CLIENT_ID=<copié depuis dev.twitch.tv>
TWITCH_CLIENT_SECRET=<copié depuis dev.twitch.tv>

STREAMER_SPIKE_ENABLED=1
STREAMER_OAUTH_KEY=<sortie de la commande crypto.randomBytes ci-dessus>
STREAMER_OAUTH_REDIRECT_URI=https://nodyx.org/api/v1/streamer/twitch/callback
STREAMER_PUBLIC_BASE=https://nodyx.org
```

### 4. Build et redémarrer nodyx-core en prod

```bash
cd /var/www/nexus/nodyx-core
npm run build
sudo -u nodyx pm2 restart nodyx-core
sudo -u nodyx pm2 logs nodyx-core --lines 20
```

Au redémarrage, dans les logs : `🧪 Streamer Hub spike chargé (oauth + eventsub)`.

## Run du spike

### Test 1 - OAuth round-trip

Dans le navigateur, ouvre :
```
https://nodyx.org/api/v1/streamer/twitch/auth
```

Tu es redirigé vers `id.twitch.tv/oauth2/authorize`. Connecte-toi avec ton compte de stream et clique **Authorize**.

Twitch te redirige sur `/api/v1/streamer/twitch/callback` qui répond en JSON :

```json
{
  "ok": true,
  "streamer": {
    "externalId": "123456789",
    "externalLogin": "tonpseudo",
    "displayName": "TonPseudo",
    "scopesGranted": ["user:read:email", "user:read:chat", "..."],
  },
  "eventSub": {
    "subscriptionId": "...",
    "status": "webhook_callback_verification_pending",
    "type": "stream.online"
  },
  "next": "Lance ton stream Twitch — le webhook stream.online sera reçu ici (logs nodyx-core)."
}
```

Critère GO : `ok: true` et tous les scopes demandés sont retournés (Twitch peut en refuser certains).

### Test 2 - EventSub callback verification

Dans la milliseconde suivant le subscribe, Twitch nous pousse un POST sur `/api/v1/integrations/twitch/eventsub/:nonce` avec `Twitch-Eventsub-Message-Type: webhook_callback_verification`. Le handler vérifie HMAC-SHA256 et renvoie le challenge en text/plain.

Logs attendus dans pm2 :
```
EventSub verification OK → enabled
```

Si tu vois `EventSub HMAC invalid` à la place : le secret partagé n'a pas été correctement transmis ou la HMAC est mal calculée. C'est exactement ce qu'on cherche à détecter en Phase 0.

### Test 3 - Refresh token

Pour forcer un refresh proactif (sans attendre que l'access token expire dans 4h) :
```
https://nodyx.org/api/v1/streamer/twitch/refresh?id=<externalId reçu au callback>
```

Réponse :
```json
{
  "ok": true,
  "externalLogin": "tonpseudo",
  "newExpiresAt": "2026-05-08T16:30:00.000Z",
  "scopes": [...]
}
```

### Test 4 - Stream online webhook

Lance un stream Twitch sur le compte connecté. Quelques secondes après le go-live, dans les logs pm2 :

```
🎬 EventSub notification reçue
{
  subId: "...",
  eventType: "stream.online",
  event: {
    broadcaster_user_id: "123456789",
    broadcaster_user_login: "tonpseudo",
    started_at: "2026-05-08T15:30:00Z",
    type: "live"
  }
}
```

C'est le canary qui valide toute la chaîne : Twitch nous a accepté comme webhook destinataire, la HMAC marche, la dedup marche, on parse l'event correctement.

## Critères GO / NO-GO

| Test | GO | NO-GO |
|---|---|---|
| OAuth round-trip | scopes demandés tous retournés | scope `user:read:chat` ou autre refusé |
| EventSub callback verification | log `verification OK` | log `HMAC invalid` ou timeout 10 s sans challenge |
| Refresh token | nouvelle expiry 4h en avance | erreur 400 / 401 Twitch |
| Stream online webhook | log `🎬 EventSub notification` | rien ne tombe dans les logs après go-live |
| `channel.chat.message` (test 5) | subscription créée | erreur 400 "scope unauthorized" → §15.bis #1 confirmé |

## Cleanup post-spike

Si **GO sur tous les points** : on garde le code (pas de jet) comme socle Phase 1. Migration vers `src/services/streamer/` + ajout migration 078, voir SPEC.MD §14.

Si **NO-GO sur ≥ 1 point** : on documente le blocage dans `PHASE_0_REPORT.md` (à créer), on adapte la spec, on relance.

Pour désactiver le spike sans toucher au code :
```bash
# .env :
STREAMER_SPIKE_ENABLED=0
sudo -u nodyx pm2 restart nodyx-core
```

Les routes disparaissent, les credentials Twitch restent en place pour le widget homepage.

Pour tout supprimer :
```bash
rm -rf nodyx-core/src/spike/
rm nodyx-core/src/tests/streamer-spike-crypto.test.ts
```

Et retirer le bloc `if (process.env.STREAMER_SPIKE_ENABLED === '1')` dans `src/index.ts`.

## Sécurité du spike

- Pas d'auth admin sur les routes spike (le user qui clique = le streamer). À ne PAS reproduire en Phase 1.
- Tokens stockés en mémoire (perdus au restart). Phase 1 : DB chiffrée.
- Pas de migration DB. Phase 1 : migration 078.
- Sous le coup de `STREAMER_SPIKE_ENABLED=1` uniquement. Désactivable instantanément.
- Le code respecte déjà §12.1 (master + sel HKDF), §12.2 (nonce URL EventSub + HMAC), §12.3 (rotation déclenchable via `/refresh`). Récupérable presque tel quel pour Phase 1.

## Références

- Spec complète : [SPEC.MD](SPEC.MD)
- Twitch OAuth : <https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/>
- Twitch EventSub : <https://dev.twitch.tv/docs/eventsub/>
- Twitch EventSub subscription types : <https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/>
