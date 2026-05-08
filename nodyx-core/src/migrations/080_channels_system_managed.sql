-- Migration 080 — Channel "system-managed" flag.
--
-- Marque un channel comme géré par un service (Streamer Hub, futurs modules
-- bots, etc.). Quand TRUE, seuls les owners/admins/moderators de la
-- community peuvent y écrire via le socket chat:send. Le service lui-même
-- pousse via Channel.addMessage() qui bypass le socket handler, donc aucun
-- impact sur les system messages.

ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_system_managed BOOLEAN NOT NULL DEFAULT FALSE;

-- Marque rétroactivement le channel #streamer-events s'il existe déjà
-- (auto-créé en Phase 1 via streamerChat.ensureStreamerEventsChannel).
UPDATE channels SET is_system_managed = TRUE WHERE slug = 'streamer-events';
