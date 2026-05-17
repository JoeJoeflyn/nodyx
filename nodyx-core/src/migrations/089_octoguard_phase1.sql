-- 089_octoguard_phase1.sql
-- Tables OctoGuard Phase 1 (modérateur automatique natif Nodyx).
-- Spec : docs/specs/016-Octoguard/016-OctoGuard.md v2.1.1
--
-- Principe : aucune table doublon vs existant Nodyx.
-- - Pas de octoguard_logs → logs unifiés dans admin_audit_log
-- - Pas de type 'flood' → couvert par socket/rateLimiter.ts
-- - ban_temp utilise community_bans + expires_at (migration 088)
--
-- État initial : aucune règle préchargée. OCTOGUARD_ENABLED par
-- défaut false côté env. L'admin construit son cadre depuis zéro.
-- Migration entièrement idempotente (IF NOT EXISTS + DO blocks).

BEGIN;

-- ─── Module 1 : Auto-modération ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS octoguard_automod_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(100) NOT NULL,
  type                  VARCHAR(32) NOT NULL,
  params                JSONB NOT NULL DEFAULT '{}'::jsonb,
  action                VARCHAR(32) NOT NULL,
  action_duration       JSONB,           -- {value:int, unit:'m'|'h'|'d'|'w'|'M'} ou null/'perm'
  escalation            JSONB,
  immunized_role_types  TEXT[] NOT NULL DEFAULT ARRAY['owner','admin','moderator'],
  immunized_grade_ids   UUID[] NOT NULL DEFAULT '{}',
  dry_run               BOOLEAN NOT NULL DEFAULT false,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'octoguard_automod_rules_type_check') THEN
    ALTER TABLE octoguard_automod_rules
      ADD CONSTRAINT octoguard_automod_rules_type_check
      CHECK (type IN ('regex','caps','link_domain','mention_spam','link_spam'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'octoguard_automod_rules_action_check') THEN
    ALTER TABLE octoguard_automod_rules
      ADD CONSTRAINT octoguard_automod_rules_action_check
      CHECK (action IN ('delete','warn','mute','ban_temp','notify_only','report_only'));
  END IF;
END
$mig$;

CREATE INDEX IF NOT EXISTS idx_octoguard_automod_enabled
  ON octoguard_automod_rules(enabled) WHERE enabled = true;

-- ─── Module 2 : Welcome (singleton) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS octoguard_welcome (
  id              INT PRIMARY KEY DEFAULT 1,
  channel_id      UUID,
  public_message  TEXT,
  dm_message      TEXT,
  dm_enabled      BOOLEAN NOT NULL DEFAULT false,
  auto_grade_id   UUID,
  enabled         BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'octoguard_welcome_singleton') THEN
    ALTER TABLE octoguard_welcome
      ADD CONSTRAINT octoguard_welcome_singleton CHECK (id = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'octoguard_welcome_auto_grade_fk') THEN
    -- FK conditionnelle : grades existe-t-elle ?
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'grades') THEN
      ALTER TABLE octoguard_welcome
        ADD CONSTRAINT octoguard_welcome_auto_grade_fk
        FOREIGN KEY (auto_grade_id) REFERENCES grades(id) ON DELETE SET NULL;
    END IF;
  END IF;
END
$mig$;

INSERT INTO octoguard_welcome (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── Module 3 : Commandes custom ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS octoguard_commands (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command          VARCHAR(64) NOT NULL UNIQUE,
  response         TEXT NOT NULL,
  cooldown_seconds INT NOT NULL DEFAULT 5,
  allowed_channels UUID[],
  allowed_roles    TEXT[],
  enabled          BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'octoguard_commands_cooldown_check') THEN
    ALTER TABLE octoguard_commands
      ADD CONSTRAINT octoguard_commands_cooldown_check
      CHECK (cooldown_seconds >= 0);
  END IF;
END
$mig$;

CREATE INDEX IF NOT EXISTS idx_octoguard_commands_enabled
  ON octoguard_commands(command) WHERE enabled = true;

-- ─── Module 4 : Warns (avec escalation) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS octoguard_warns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id    UUID REFERENCES octoguard_automod_rules(id) ON DELETE SET NULL,
  reason     TEXT,
  cleared_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_octoguard_warns_user_active
  ON octoguard_warns(user_id) WHERE cleared_at IS NULL;

-- ─── Module 6 : Mute / Timeout chat ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_mutes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  reason     TEXT,
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Pas de NOW() dans un predicate (refusé par PG, fonction non IMMUTABLE).
-- Index composite : permet lookup par user_id + filtre expires_at au query.
CREATE INDEX IF NOT EXISTS idx_chat_mutes_user_expires
  ON chat_mutes(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_chat_mutes_channel
  ON chat_mutes(channel_id) WHERE channel_id IS NOT NULL;

-- ─── Module 7 : Reports utilisateur ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  target_type   VARCHAR(32) NOT NULL,
  target_id     UUID NOT NULL,
  reason        TEXT NOT NULL,
  category      VARCHAR(32),
  status        VARCHAR(16) NOT NULL DEFAULT 'open',
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  resolution    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_target_type_check') THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_target_type_check
      CHECK (target_type IN ('message','user','thread','post','dm_message'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_status_check') THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_status_check
      CHECK (status IN ('open','reviewed','dismissed','actioned'));
  END IF;
END
$mig$;

CREATE INDEX IF NOT EXISTS idx_reports_status_created
  ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target
  ON reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter
  ON reports(reporter_id, created_at DESC) WHERE reporter_id IS NOT NULL;

-- Anti-abuse paramétrable (singleton)
CREATE TABLE IF NOT EXISTS reports_settings (
  id                        INT PRIMARY KEY DEFAULT 1,
  rate_limit_per_hour       INT NOT NULL DEFAULT 5,
  cooldown_per_target_hours INT NOT NULL DEFAULT 24,
  enabled                   BOOLEAN NOT NULL DEFAULT true,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_settings_singleton') THEN
    ALTER TABLE reports_settings
      ADD CONSTRAINT reports_settings_singleton CHECK (id = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_settings_rate_check') THEN
    ALTER TABLE reports_settings
      ADD CONSTRAINT reports_settings_rate_check
      CHECK (rate_limit_per_hour >= 0 AND cooldown_per_target_hours >= 0);
  END IF;
END
$mig$;

INSERT INTO reports_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── Module 5 : Webhook sortant (singleton) ────────────────────────────────

CREATE TABLE IF NOT EXISTS octoguard_webhook (
  id         INT PRIMARY KEY DEFAULT 1,
  url        TEXT,
  secret     TEXT,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'octoguard_webhook_singleton') THEN
    ALTER TABLE octoguard_webhook
      ADD CONSTRAINT octoguard_webhook_singleton CHECK (id = 1);
  END IF;
END
$mig$;

INSERT INTO octoguard_webhook (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMIT;
