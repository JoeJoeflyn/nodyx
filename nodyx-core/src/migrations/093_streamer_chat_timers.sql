-- ─── Streamer Hub — Chat timers (auto-messages périodiques) ───────────────
-- Permet de poster des messages bot récurrents dans le chat Twitch pour
-- guider les viewers : invite Nodyx, schedule, rappel commandes, etc.
--
-- Le scheduler interne tick toutes les 60s. À chaque tick, pour chaque timer
-- enabled :
--   - si live_only et stream offline → skip
--   - si delta(now, last_sent_at) < interval_minutes → skip
--   - si nb messages chat depuis last_sent_at < min_chat_messages → skip
--     (anti-spam chat vide : si personne ne parle, le bot ne parle pas non plus)
--   - sinon → render template, send via relayMessageToTwitch, update last_sent_at
--
-- Le compteur de messages chat est tenu en Redis (streamer:chat:msgs_count:<id>),
-- incrémenté à chaque chat inbound, reset à 0 à chaque send réussi du timer.

CREATE TABLE IF NOT EXISTS streamer_chat_timers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label              TEXT NOT NULL,                                    -- nom interne ("Pub Nodyx", "Schedule", etc)
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  message_template   TEXT NOT NULL,                                    -- texte avec variables {nodyx_url}, {streamer}, {uptime}
  interval_minutes   INTEGER NOT NULL DEFAULT 15 CHECK (interval_minutes >= 5),
  min_chat_messages  INTEGER NOT NULL DEFAULT 5 CHECK (min_chat_messages >= 0),
  live_only          BOOLEAN NOT NULL DEFAULT TRUE,
  last_sent_at       TIMESTAMPTZ,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour le tick scheduler : on scan les enabled triés par last_sent_at
-- (les plus anciens en premier pour la fairness).
CREATE INDEX IF NOT EXISTS idx_streamer_chat_timers_enabled
  ON streamer_chat_timers(enabled, last_sent_at NULLS FIRST)
  WHERE enabled = TRUE;
