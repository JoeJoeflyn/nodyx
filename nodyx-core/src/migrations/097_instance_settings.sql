-- ─── Panneau de configuration admin — settings éditables depuis l'UI ──────────
-- Spec 017. Permet à l'admin de configurer Nodyx (identité, intégrations,
-- toggles) sans éditer le .env en SSH/FTP.
--
-- Architecture hybride : le .env garde le bootstrap (DB, JWT, PORT) ; tout le
-- reste vit ici. Une couche `config/settings.ts` charge cette table dans
-- process.env au boot (après dotenv.config()) et à chaque changement, ce qui
-- applique la plupart des réglages À CHAUD sans redémarrage (la majorité des
-- variables sont relues à chaque appel : SMTP, flags, identité, etc).
--
-- Précédence : pour une clé donnée, la valeur DB écrase celle du .env.
-- Une table vide = comportement strictement identique à aujourd'hui (le .env
-- reste seul maître). La feature est donc purement additive et non cassante.
--
-- Secrets (Phase 2) : chiffrés au repos en AES-256-GCM via services/streamer/
-- crypto.ts (colonnes value_enc/salt/iv/tag/kver). Jamais renvoyés en clair au
-- client. Les non-secrets vivent en clair dans `value`.

CREATE TABLE IF NOT EXISTS instance_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,                              -- valeur en clair (réglages non-secrets)
  value_enc   BYTEA,                             -- ciphertext AES-256-GCM (secrets, Phase 2)
  salt        BYTEA,                             -- sel HKDF par row (16 octets)
  iv          BYTEA,                             -- IV unique par chiffrement (12 octets)
  tag         BYTEA,                             -- tag GCM (16 octets)
  kver        INTEGER NOT NULL DEFAULT 1,        -- version master key (rotation future)
  is_secret   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
