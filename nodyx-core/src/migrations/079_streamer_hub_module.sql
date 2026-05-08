-- Migration 079 — Enregistre le module Streamer Hub dans la table `modules`.
-- Pattern aligné sur 062 : INSERT ON CONFLICT DO NOTHING pour préserver
-- l'état admin sur les instances qui appliqueraient la migration plusieurs
-- fois (idempotent).
--
-- Le module est par défaut activé (true) parce que sur les instances déjà
-- migrées en Phase 1, l'admin a clairement opté pour le streamer hub en
-- configurant les credentials Twitch dans .env. S'il veut le désactiver,
-- il le toggle depuis /admin/modules.

INSERT INTO modules (id, family, enabled) VALUES
  ('streamer-hub', 'integration', true)
ON CONFLICT (id) DO NOTHING;
