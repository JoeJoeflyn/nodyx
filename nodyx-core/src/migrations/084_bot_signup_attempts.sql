-- Migration 084 : journal des tentatives de signup bot interceptées
-- Chaque entrée = une requête sur /auth/register bloquée par le layered defense
-- (honeypot/timing/pattern). Permet de monitorer la pression bot dans Olympus
-- et de détecter une éventuelle nouvelle vague.

CREATE TABLE IF NOT EXISTS bot_signup_attempts (
  id          BIGSERIAL PRIMARY KEY,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason      TEXT        NOT NULL CHECK (reason IN (
    'honeypot_filled',
    'too_fast',
    'bot_username_pattern',
    'email_banned',
    'ip_banned'
  )),
  username    TEXT,
  email       TEXT,
  ip          INET,
  user_agent  TEXT,
  -- Contexte additionnel (elapsed_ms si too_fast, etc.) en JSON.
  metadata    JSONB
);

CREATE INDEX IF NOT EXISTS idx_bot_signup_attempted
  ON bot_signup_attempts(attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_signup_reason
  ON bot_signup_attempts(reason, attempted_at DESC);
