-- Migration 078 — Streamer Hub (spec 015-streamer-hub, Phase 1 Foundations)
--
-- Sept tables :
--   streamer_oauth_tokens         : tokens chiffrés AES-256-GCM, dérivés HKDF(master, salt)
--   streamer_eventsub_subscriptions : 1 par streamer × event_type, nonce URL + secret HMAC chiffré
--   streamer_events               : événements EventSub reçus (audit + dispatch)
--   streamer_sessions             : 1 par session de stream, peuplée à stream.online / .offline
--   streamer_obs_config           : singleton, config OBS WebSocket v5 (Phase 3)
--   streamer_audit_log            : actions sensibles (connect, disconnect, config, generate)
--   ALTER users : twitch_id, twitch_login pour le mapping viewer (§7)
--
-- Sécurité §12 :
--   - chiffrement AES-256-GCM avec clé dérivée HKDF(master_key_v{N}, enc_salt) par row
--   - une fuite de la DB seule ne suffit pas à déchiffrer les tokens (master key absente)
--   - rotation master key mensuelle prévue Phase 5 via key_version
--   - rotation forcée tokens 30j prévue Phase 5 via rotated_at + cron

-- ─── Tokens OAuth chiffrés (provider × streamer) ─────────────────────────────
-- Chaque token (access + refresh) a son propre triplet (salt, iv, tag) pour
-- que GCM reste correct (jamais 2 IV identiques sous la même clé dérivée).
-- key_version est partagé entre les deux : ils sont rotated ensemble.
CREATE TABLE IF NOT EXISTS streamer_oauth_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL CHECK (provider IN ('twitch', 'owncast', 'peertube', 'youtube', 'kick')),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  external_id       TEXT NOT NULL,                          -- Twitch user_id, etc.
  external_login    TEXT NOT NULL,
  -- access_token : ciphertext + son propre triplet HKDF/GCM
  access_token_enc  BYTEA NOT NULL,
  access_salt       BYTEA NOT NULL,                         -- 16 octets HKDF salt
  access_iv         BYTEA NOT NULL,                         -- 12 octets IV unique
  access_tag        BYTEA NOT NULL,                         -- 16 octets tag GCM
  -- refresh_token : ciphertext + son propre triplet HKDF/GCM
  refresh_token_enc BYTEA NOT NULL,
  refresh_salt      BYTEA NOT NULL,
  refresh_iv        BYTEA NOT NULL,
  refresh_tag       BYTEA NOT NULL,
  -- master_key_v{N}, partagé pour les deux tokens. Rotation Phase 5.
  key_version       INTEGER NOT NULL DEFAULT 1,
  scopes            TEXT[] NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  is_streamer       BOOLEAN NOT NULL DEFAULT FALSE,         -- TRUE pour le streamer principal
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),     -- dernière rotation forcée Twitch
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_streamer_oauth_user
  ON streamer_oauth_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_streamer_oauth_streamer
  ON streamer_oauth_tokens(provider, is_streamer) WHERE is_streamer = TRUE;

-- ─── Souscriptions EventSub (1 par streamer × event_type) ────────────────────
-- Stocke le secret HMAC partagé avec Twitch + le nonce d'URL (§12.2 spec).
-- Le nonce dans l'URL `/eventsub/:nonce` permet de retrouver le bon secret
-- HMAC sans exposer un endpoint global devinable.
CREATE TABLE IF NOT EXISTS streamer_eventsub_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,
  external_sub_id TEXT NOT NULL,                              -- ID côté Twitch
  event_type      TEXT NOT NULL,                              -- 'channel.follow', 'stream.online', etc.
  callback_nonce  TEXT NOT NULL,                              -- 32 octets aléatoires base64url
  hmac_secret_enc BYTEA NOT NULL,                             -- secret HMAC partagé, AES-256-GCM
  hmac_salt       BYTEA NOT NULL,
  hmac_iv         BYTEA NOT NULL,
  hmac_tag        BYTEA NOT NULL,
  hmac_kver       INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'pending',            -- 'pending', 'enabled', 'revoked', 'failed'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enabled_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  UNIQUE (provider, callback_nonce),
  UNIQUE (provider, event_type)
);

CREATE INDEX IF NOT EXISTS idx_streamer_eventsub_nonce
  ON streamer_eventsub_subscriptions(callback_nonce);

CREATE INDEX IF NOT EXISTS idx_streamer_eventsub_status
  ON streamer_eventsub_subscriptions(provider, status);

-- ─── Events temps-réel (follow, sub, raid, bits, polls, stream.online/offline) ───
CREATE TABLE IF NOT EXISTS streamer_events (
  id           BIGSERIAL PRIMARY KEY,
  provider     TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  external_id  TEXT,                                       -- ID Twitch / Owncast / etc.
  payload      JSONB NOT NULL,                             -- payload complet du provider
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL, -- viewer Nodyx si lié
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ                                 -- NULL si pas encore dispatch
);

CREATE INDEX IF NOT EXISTS idx_streamer_events_occurred
  ON streamer_events(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_streamer_events_type
  ON streamer_events(event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_streamer_events_user
  ON streamer_events(user_id, occurred_at DESC) WHERE user_id IS NOT NULL;

-- ─── Lien viewer Twitch ↔ user Nodyx (3 flows §7) ───────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS twitch_id    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS twitch_login TEXT;

-- Unique partial index (on autorise NULL multiples mais pas deux comptes même twitch_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_twitch_id_unique
  ON users(twitch_id) WHERE twitch_id IS NOT NULL;

-- ─── Sessions de stream (1 par go-live) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS streamer_sessions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider               TEXT NOT NULL,
  external_id            TEXT NOT NULL,                      -- Twitch stream_id
  thread_id              UUID REFERENCES threads(id) ON DELETE SET NULL,
  started_at             TIMESTAMPTZ NOT NULL,
  ended_at               TIMESTAMPTZ,
  peak_viewers           INTEGER DEFAULT 0,
  total_followers_gained INTEGER DEFAULT 0,
  total_subs_gained      INTEGER DEFAULT 0,
  total_bits             INTEGER DEFAULT 0,
  total_raids_in         INTEGER DEFAULT 0,
  category               TEXT,
  title                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_streamer_sessions_started
  ON streamer_sessions(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_streamer_sessions_open
  ON streamer_sessions(ended_at) WHERE ended_at IS NULL;

-- ─── OBS WebSocket configuration (Phase 3, singleton) ───────────────────────
CREATE TABLE IF NOT EXISTS streamer_obs_config (
  id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  ws_url        TEXT,                                          -- ex: ws://localhost:4455
  password_enc  BYTEA,
  password_salt BYTEA,
  password_iv   BYTEA,
  password_tag  BYTEA,
  password_kver INTEGER DEFAULT 1,
  scenes_layout JSONB NOT NULL DEFAULT '[]',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO streamer_obs_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ─── Audit log (pattern aligné sur backup_audit_log) ────────────────────────
CREATE TABLE IF NOT EXISTS streamer_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
                                                          -- 'connect_twitch', 'disconnect_twitch',
                                                          -- 'refresh_token', 'token_decrypt_failed',
                                                          -- 'config_obs', 'generate_extension',
                                                          -- 'eventsub_subscribe', 'eventsub_revoked',
                                                          -- 'hmac_invalid'
  ip_address   INET,
  metadata     JSONB,
  status       TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_streamer_audit_created
  ON streamer_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_streamer_audit_action
  ON streamer_audit_log(action, created_at DESC);
