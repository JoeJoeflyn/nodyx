-- ─── Streamer Hub — Chat commands custom (Phase C) ────────────────────────
-- Permet à l'admin de créer ses propres commandes chat avec un template de
-- réponse. Quand un viewer tape "!<name>" dans le chat Twitch, le bot répond
-- avec le template rendu (variables {nodyx_url}, {streamer}, {uptime}).
--
-- Les commands hardcoded (!nodyx, !uptime, !commands, !topclips, !so,
-- !highlight) restent prioritaires : on ne peut PAS créer une custom command
-- avec un nom déjà utilisé en dur (check côté service).
--
-- name : doit commencer par "!", composé de lettres ASCII / chiffres /
-- underscore / tiret. Stocké lowercase pour permettre un match case-insensitive
-- lors du dispatch.

CREATE TABLE IF NOT EXISTS streamer_chat_commands (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL UNIQUE CHECK (name ~ '^![a-z0-9_-]{1,30}$'),
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  response_template TEXT NOT NULL,
  mod_only          BOOLEAN NOT NULL DEFAULT FALSE,
  cooldown_seconds  INTEGER NOT NULL DEFAULT 30 CHECK (cooldown_seconds BETWEEN 5 AND 3600),
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour le lookup dispatch (uniquement les enabled).
CREATE INDEX IF NOT EXISTS idx_streamer_chat_commands_lookup
  ON streamer_chat_commands(name) WHERE enabled = TRUE;
