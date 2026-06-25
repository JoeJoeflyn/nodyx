-- Migration 109 — Backup de clé E2E (récupération multi-appareil).
-- Le serveur ne stocke qu'un BLOB OPAQUE : la clé privée chiffrée côté client
-- avec une clé dérivée de la passphrase de l'utilisateur (PBKDF2 + AES-GCM).
-- Le serveur reste AVEUGLE : il ne peut jamais lire la clé. Passphrase perdue =
-- backup inutile (zéro-knowledge, assumé).
CREATE TABLE IF NOT EXISTS e2e_key_backups (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  blob       TEXT        NOT NULL,   -- ciphertext base64 (IV + données chiffrées)
  salt       TEXT        NOT NULL,   -- base64, sel du KDF
  kdf        TEXT        NOT NULL DEFAULT 'PBKDF2-SHA256',
  kdf_iters  INTEGER     NOT NULL DEFAULT 600000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
