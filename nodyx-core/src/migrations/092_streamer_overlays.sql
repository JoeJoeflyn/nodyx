-- ─── Streamer Hub — Overlays OBS (Phase 3, suite) ──────────────────────────
-- Browser sources que le streamer colle dans OBS comme "Browser Source".
-- Chaque overlay a un token unguessable qui sert d'auth (à la place d'un JWT)
-- et permet à la page transparente d'établir une socket vers Nodyx pour
-- recevoir en temps réel les events EventSub (follow/sub/raid/cheer/etc).
--
-- Le token est généré côté serveur (crypto.randomBytes 32 → 43 chars base64url)
-- et stocké en clair (pas de hash) parce que la page overlay doit pouvoir
-- s'authentifier en envoyant le token tel quel. La compromission d'un token
-- ne permet QUE de recevoir les events publics, pas de muter quoi que ce soit.
-- En cas de fuite, le streamer peut revoke et générer un nouveau token.

CREATE TABLE IF NOT EXISTS streamer_overlays (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token         TEXT NOT NULL UNIQUE,
  overlay_type  TEXT NOT NULL,                       -- 'alert_box', 'goal_bar', 'stream_timer', 'event_ticker', 'leaderboard'
  label         TEXT,                                -- nom donné par le streamer ("Alert Box principale" etc)
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ,                         -- soft-delete : on garde la row pour l'audit
  last_seen_at  TIMESTAMPTZ                          -- dernière connexion socket de l'overlay (debug)
);

-- Index principal : lookup par token côté socket auth (skip les revoqués).
CREATE INDEX IF NOT EXISTS idx_streamer_overlays_token_active
  ON streamer_overlays(token) WHERE revoked_at IS NULL;

-- Index pour le listing admin (overlays actifs récents d'abord).
CREATE INDEX IF NOT EXISTS idx_streamer_overlays_active_created
  ON streamer_overlays(created_at DESC) WHERE revoked_at IS NULL;
