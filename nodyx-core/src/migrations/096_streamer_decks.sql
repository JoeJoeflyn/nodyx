-- ─── Streamer Hub — Nodyx Deck (tactile / mobile Stream Deck-like) ─────────
-- Permet au streamer de configurer une grille de boutons accessible depuis
-- une URL mobile-first (/deck/<token>) qui déclenche des actions Nodyx :
--   - top_clips        : lance les top clips dans un overlay player
--   - vod_marker       : place un marker à la position courante du stream
--   - chat_message     : poste un message libre dans le chat Twitch
--   - trigger_command  : déclenche une command chat custom (!discord, etc)
--
-- L'auth se fait par token unguessable (43 chars base64url, comme les
-- overlays). Le streamer peut revoke et générer un nouveau token en cas de
-- compromission.
--
-- Le layout est stocké en JSONB pour permettre l'évolution sans migration :
--   {
--     "rows":    3,
--     "cols":    4,
--     "buttons": [
--       {
--         "id":       "uuid",
--         "x":        0,                          // colonne
--         "y":        0,                          // ligne
--         "w":        1,                          // largeur en cellules
--         "h":        1,                          // hauteur en cellules
--         "label":    "Top Clips",
--         "icon":     "🎬",                       // emoji ou nom heroicon
--         "gradient": "cyber",                    // preset ou hex/hex custom
--         "action":   { "type": "top_clips", "overlayId": "uuid", "period": "7d", "count": 5 }
--       },
--       ...
--     ]
--   }

CREATE TABLE IF NOT EXISTS streamer_decks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token         TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL DEFAULT 'Mon Deck',
  layout        JSONB NOT NULL DEFAULT '{"rows":3,"cols":4,"buttons":[]}'::jsonb,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ
);

-- Lookup par token côté mobile bootstrap (skip les revoqués).
CREATE INDEX IF NOT EXISTS idx_streamer_decks_token_active
  ON streamer_decks(token) WHERE revoked_at IS NULL;
