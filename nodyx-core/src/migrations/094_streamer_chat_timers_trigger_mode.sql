-- ─── Streamer Hub — Chat timers : trigger modes ───────────────────────────
-- Étend les chat timers avec un mode de déclenchement :
--   - 'recurring'      : tourne en boucle à l'intervalle défini (comportement
--                        historique, default sur les rows existantes)
--   - 'once_per_live'  : envoyé une seule fois par session de stream, reset
--                        au prochain go-live. Idéal pour les phrases d'accueil.
--   - 'once'           : envoyé une seule fois définitivement, puis le timer
--                        s'auto-désactive (enabled → false). Utile pour des
--                        annonces ponctuelles.

ALTER TABLE streamer_chat_timers
  ADD COLUMN IF NOT EXISTS trigger_mode TEXT NOT NULL DEFAULT 'recurring'
    CHECK (trigger_mode IN ('recurring', 'once_per_live', 'once'));
