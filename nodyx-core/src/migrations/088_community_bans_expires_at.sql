-- 088_community_bans_expires_at.sql
-- Ajoute la notion de ban temporaire à community_bans existante.
-- expires_at NULL = ban permanent (comportement actuel inchangé).
-- expires_at futur = ban temporaire, à purger automatiquement.
-- Migration légère, utile pour TOUT le projet, pas que OctoGuard
-- (Spec OctoGuard v2.1 §Migrations SQL 088).

BEGIN;

ALTER TABLE community_bans
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_community_bans_expires
  ON community_bans(expires_at)
  WHERE expires_at IS NOT NULL;

COMMIT;
