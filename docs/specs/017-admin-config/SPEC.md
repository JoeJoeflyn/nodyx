# Nodyx — Panneau de configuration admin (Settings UI)

**Statut** : CDC draft, en attente de validation Jonathan avant tout code
**Numéro de spec** : 017
**Auteur** : Jonathan (Pokled) + Claude
**Décision d'archi prise** : hybride DB + `.env` minimal (validée 2026-05-29)
**Branches** : `spec/admin-config` (CDC) puis `feat/admin-config` (code)

---

## 1. Vision & problème

Aujourd'hui, pour activer le SMTP, brancher Twitch, ou même changer le nom de l'instance, l'admin doit éditer le `.env` en SSH/FTP. C'est :
- **lourd** : un aller-retour terminal pour chaque réglage
- **dangereux** : un néophyte peut casser le fichier, ou pire, casser une variable vitale (`DB_PASSWORD`, `JWT_SECRET`) et brick l'instance
- **opaque** : rien dans l'UI ne dit ce qui est configurable

> Un admin néophyte ne devrait jamais avoir à ouvrir un terminal pour configurer Nodyx.

Aligné avec `feedback_admin_freedom` (liberté max à l'admin, garde-fous techniques seulement) et la méthode "zones noires" (corriger les douleurs des concurrents). C'est un avantage produit concret face aux plateformes qui imposent le terminal.

## 2. Constat technique (analyse du `.env`)

77 variables `process.env` distinctes dans `nodyx-core/src`. Deux faits décisifs vérifiés :

1. **`dotenv.config()` ne charge le `.env` qu'une fois, au boot** (`src/config/database.ts:5`). Écrire dans le fichier ne change RIEN sur le process qui tourne sans redémarrage.
2. **La plupart des variables sont relues à chaque appel** : SMTP (`createTransport()` relit `process.env.SMTP_*` à chaque envoi), `JWT_SECRET` (`jwt.verify` à chaque requête), `NODYX_GLOBAL_INDEXING`, `OCTOGUARD_ENABLED`, etc. → si on met à jour **`process.env` en mémoire**, le changement est pris en compte **à chaud**.
   - Exception : ce qui est lu au **module-init**, surtout le pool PG (`new Pool({ host: process.env.DB_HOST })`) et `PORT`/`HOST`. Ces variables exigent un **redémarrage**.

C'est ce constat qui valide l'archi hybride : une couche qui injecte les settings DB dans `process.env` au boot ET à chaque changement applique 90% des réglages à chaud, sans refactorer le code SANCTUAIRE qui fait déjà `process.env.X`.

## 3. Architecture : hybride DB + overlay `process.env`

```
                ┌──────────── boot ────────────┐
.env (bootstrap minimal)  →  dotenv.config()  →  process.env
                                                     ▲
table instance_settings (DB)  →  loadSettingsIntoEnv()  ┘  (overlay, après dotenv)

         ┌──────── changement via admin ────────┐
admin UI → API → validate → persist DB → applySettingToEnv(key) → process.env muté
                                                  │
                          si tier=restart → bannière "redémarrage requis" + bouton restart PM2 contrôlé
```

- **`.env` = bootstrap only** : ce que le process doit lire AVANT que la DB soit joignable. `DB_*`, `REDIS_*`, `JWT_SECRET`, `PORT`, `HOST`, `NODE_ENV`. On n'y touche plus depuis l'UI en temps normal (tier 1, voir §4).
- **Table `instance_settings`** : tout le reste. Source de vérité runtime.
- **Couche config** (`src/config/settings.ts`) : charge la table → `process.env` au boot (après `dotenv.config()`), et expose `setSetting(key, value)` qui persiste + ré-applique à `process.env` + log audit.
- **Précédence** : DB settings écrasent `.env` pour les clés tier 2/3. `.env` reste maître pour tier 1.

Avantage clé : **invasion minimale du SANCTUAIRE**. Le code existant continue de lire `process.env.SMTP_HOST` sans modif ; seule la source d'alimentation de `process.env` change.

## 4. Tiering des variables (garde-fou anti-brick)

Chaque variable est classée. Le tier pilote l'UI (warnings, restart) et les permissions.

| Tier | Définition | Comportement à la sauvegarde | Exemples |
|---|---|---|---|
| **1 — Bootstrap / vital** | Lu au boot, nécessaire au démarrage. Erreur = brick. | Reste dans `.env`. Édition possible mais derrière un gros warning + double confirmation + redémarrage + rollback healthcheck. **Phase 3, pas avant.** | `DB_*`, `REDIS_HOST/PORT`, `JWT_SECRET`, `PORT`, `HOST`, `NODE_ENV` |
| **2 — Restart requis** | Lu au module-init mais pas vital au boot. | Persist DB + bannière "redémarrage requis". | `UPLOADS_DIR`, `BACKUP_DIR`, `STREAMER_OAUTH_KEY`, certains clients init au boot |
| **3 — Hot-applicable** | Relu à chaque appel. | Persist DB + injecte `process.env` → effet immédiat. | SMTP, `TWITCH_*`, `STREAMER_*`, VAPID, MISP, CF, TURN, identité communauté, `NODYX_GLOBAL_INDEXING`, `OCTOGUARD_ENABLED`, `NSFW_*`, webhooks, clés API externes |

La majorité des 77 (l'utile pour l'admin : SMTP, Twitch, identité, toggles, intégrations) est **tier 3 → à chaud**. C'est ce qui rend la feature satisfaisante.

## 5. Registry : descripteur typé par variable

Une source unique de vérité (`src/config/settingsRegistry.ts`) décrit chaque réglage. Pilote à la fois la validation backend ET le rendu du formulaire.

```ts
interface SettingDescriptor {
  key:        string                      // 'SMTP_HOST'
  group:      'identity' | 'email' | 'integrations' | 'security' | 'federation' | 'advanced'
  label:      string                      // FR + EN via i18n
  type:       'string' | 'number' | 'boolean' | 'enum' | 'secret' | 'multiline' | 'url' | 'email'
  tier:       1 | 2 | 3
  secret:     boolean                     // masqué + chiffré + jamais renvoyé en clair
  validate?:  (v: string) => string | null
  enumValues?: string[]
  help?:      string                      // texte d'aide affiché sous le champ
  default?:   string
  testable?:  'smtp' | 'twitch' | null    // bouton "tester la connexion"
}
```

## 6. Sécurité (module critique)

- **Secrets jamais renvoyés en clair au client.** Un champ `secret` déjà défini s'affiche `●●●● (défini)` avec un bouton "remplacer". L'œil cliquable révèle **uniquement ce que l'admin vient de taper** dans cette session, jamais la valeur stockée. Le GET de l'API renvoie `{ key, isSet: true }` pour les secrets, pas la valeur.
- **Chiffrement au repos** des secrets dans `instance_settings` : réutilise `services/streamer/crypto.ts` (AES-256-GCM + HKDF, déjà éprouvé). Colonnes `value_enc / salt / iv / tag / kver`.
- **Piège ownership** (`feedback_env_ownership`, incident vécu) : tant qu'on reste sur DB (tier 2/3), on ne touche PAS au `.env` → piège évité. Pour les rares écritures `.env` (tier 1, Phase 3) : écriture atomique (tmp + rename), puis `chown root:nodyx` + `chmod 600` restaurés systématiquement.
- **RBAC** : `adminOnly` strict sur toutes les routes. Audit log (`admin_audit_log`) de chaque changement : qui, quand, quelle clé, ancienne→nouvelle (valeur masquée pour les secrets, juste "modifié").
- **Validation stricte** par descripteur avant persist. Un slug invalide, un port hors borne, une URL malformée sont rejetés côté serveur.
- **Restart contrôlé** (tier 1/2) : le redémarrage PM2 est déclenché en détaché (`pm2 restart` via un worker hors du process qu'on tue), avec **healthcheck post-restart** : si l'instance ne répond pas en N secondes, rollback automatique de la dernière modif. Sinon on se verrouille dehors.
- **Mode démo** : `NODYX_DEMO_MODE` désactive l'écriture des settings (lecture seule) pour les instances de démo publiques.

## 7. UI admin (`/admin/settings`)

Onglets par groupe : **Identité**, **Email**, **Intégrations** (Twitch, push, Cloudflare, TURN), **Sécurité** (honeypot, MISP, filtres, NSFW, OctoGuard), **Fédération** (indexing, gossip, directory), **Avancé** (tier 1/2, gros warnings).

Chaque champ : label + aide, valeur courante (ou `●●●●` pour secret), validation live, badge tier ("à chaud" / "redémarrage requis" / "vital"). Boutons "tester" pour SMTP et Twitch. Bannière globale "redémarrage requis" qui apparaît si un changement tier 1/2 est en attente, avec bouton "Redémarrer maintenant".

## 8. DB — migration

```sql
CREATE TABLE instance_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,                 -- valeur en clair (non-secret)
  value_enc   BYTEA, salt BYTEA, iv BYTEA, tag BYTEA, kver INTEGER DEFAULT 1,  -- secrets
  is_secret   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

> Numéro de migration assigné au moment du code (prochaine dispo, ~097). Note : le CDC Owncast a aussi réservé 097 ; le premier des deux à merger prend 097, l'autre 098.

## 9. Phases

| Phase | Livrable | Risque |
|---|---|---|
| **1 — Socle hot (tier 3 non-secret)** | Table + registry + couche config (overlay + hot-reload) + API admin + UI groupes Identité/Fédération/toggles. Inclut le 1er win visible : changer nom/description/slug de l'instance sans SSH. | Faible |
| **2 — Secrets & intégrations** | Chiffrement secrets + champs masqués + œil + boutons test. SMTP (avec test), Twitch, VAPID, MISP, CF, TURN, clés API. C'est le cœur de ta demande. | Moyen (secrets) |
| **3 — Vitales (tier 1/2)** | Édition DB/JWT/PORT avec redémarrage PM2 orchestré + healthcheck rollback + double confirmation. | Élevé (brick) |

Phase 1 + 2 couvrent 95% du besoin réel ("activer SMTP/Twitch/identité sans terminal"). Phase 3 est optionnelle et la plus risquée : à ne faire que si vraiment demandé.

## 10. Tests (règle test-first, même session que le code)

- `settings-service.test.ts` : load DB → process.env au boot, précédence DB > .env tier 3, `setSetting` mute bien process.env (hot-reload simulé sur une clé tier 3).
- `settings-crypto.test.ts` : secret chiffré/déchiffré, test négatif (mauvaise clé → échec), secret jamais renvoyé en clair par le serializer API.
- `settings-validation.test.ts` : slug/port/url invalides rejetés par descripteur.
- `settings-audit.test.ts` : chaque setSetting log dans admin_audit_log, valeur secret masquée.
- Non-régression : `npm run build` + suite existante verte (la couche overlay ne doit pas casser les lectures `process.env` existantes).

## 11. Questions ouvertes (à trancher avec Jonathan)

1. **Restart orchestré** : on assume PM2 comme superviseur (cohérent prod), mais en dev (`npm run dev` / ts-node) il n'y a pas de superviseur → le restart tier 1/2 affiche juste "redémarre manuellement". OK ?
2. **`STREAMER_OAUTH_KEY` / `JWT_SECRET`** : ce sont des clés qui chiffrent/signent d'autres données. Les "remplacer" depuis l'UI invalide les tokens/sessions existants. On les laisse tier 1 verrouillées avec warning explicite "rotation = déconnexion de tous", ou hors UI complètement ?
3. **Périmètre Phase 1** : on démarre par l'identité de l'instance (le manque que tu pointes) + les toggles, c'est bien le bon premier livrable visible ?
4. **i18n** : labels/aide en FR + EN dès la Phase 1 (cohérent docs FR+EN) ?
5. **Pivot confirmé** : on parke le CDC Owncast (`015-streamer-hub/sessions/owncast-provider-cdc.md`) et le Hub Twitch, et ce module 017 devient le sprint actif ?
