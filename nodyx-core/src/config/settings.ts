// ─── Couche de configuration runtime (spec 017) ───────────────────────────────
// Pont entre la table `instance_settings` (DB) et `process.env`.
//
//  • loadSettingsIntoEnv()  : au boot, APRÈS dotenv.config(), injecte les
//    valeurs DB dans process.env. Précédence : DB écrase .env. Table vide =
//    process.env intact = comportement identique à aujourd'hui.
//  • setSettings()          : valide + persiste + ré-applique à process.env +
//    audit. Pour les variables relues à chaque appel (tier 3), l'effet est
//    immédiat, sans redémarrage.
//
// Le code SANCTUAIRE continue de lire `process.env.X` sans aucune modif : seule
// la source qui remplit process.env change.

import { db } from './database'
import {
  SETTINGS_REGISTRY,
  getDescriptor,
  type SettingDescriptor,
} from './settingsRegistry'

// ── Chargement au boot ───────────────────────────────────────────────────────

export async function loadSettingsIntoEnv(): Promise<void> {
  try {
    const { rows } = await db.query<{ key: string; value: string | null; is_secret: boolean }>(
      `SELECT key, value, is_secret FROM instance_settings`,
    )
    let applied = 0
    for (const row of rows) {
      // Phase 1 : uniquement les non-secrets. Les secrets (is_secret = true)
      // seront déchiffrés ici en Phase 2 via services/streamer/crypto.ts.
      if (row.is_secret) continue
      if (row.value === null) continue
      process.env[row.key] = row.value
      applied++
    }
    if (applied > 0) console.log(`[settings] ${applied} réglage(s) DB injecté(s) dans process.env`)
  } catch (err) {
    // Ne JAMAIS bloquer le boot : si la table est absente ou la requête échoue,
    // on retombe sur le .env seul (comportement historique).
    console.warn('[settings] chargement DB ignoré (fallback .env):', (err as Error).message)
  }
}

// ── Lecture (pour l'UI admin) ──────────────────────────────────────────────────

export interface EffectiveSetting {
  key:    string
  group:  SettingDescriptor['group']
  type:   SettingDescriptor['type']
  tier:   SettingDescriptor['tier']
  secret: boolean
  labelFr: string
  labelEn: string
  helpFr?: string
  helpEn?: string
  enumValues?: string[]
  placeholder?: string
  // Pour les non-secrets : la valeur effective courante. Pour les secrets :
  // jamais la valeur, juste `isSet`.
  value?:  string
  isSet?:  boolean
}

export function getEffectiveSettings(): EffectiveSetting[] {
  return SETTINGS_REGISTRY.map(d => {
    const raw = process.env[d.key]
    const base: EffectiveSetting = {
      key: d.key, group: d.group, type: d.type, tier: d.tier, secret: d.secret,
      labelFr: d.labelFr, labelEn: d.labelEn, helpFr: d.helpFr, helpEn: d.helpEn,
      enumValues: d.enumValues, placeholder: d.placeholder,
    }
    if (d.secret) {
      // On ne renvoie JAMAIS un secret en clair au client (cf §6 spec 017).
      base.isSet = !!raw && raw.length > 0
    } else {
      base.value = raw ?? ''
    }
    return base
  })
}

// ── Écriture ───────────────────────────────────────────────────────────────────

export interface SetSettingsResult {
  ok:              boolean
  errors:          Record<string, string>   // clé → message d'erreur de validation
  applied:         string[]                  // clés effectivement modifiées
  restartRequired: boolean                   // true si une clé tier ≤ 2 a changé
}

// Normalise une valeur entrante selon le type avant validation/stockage.
function normalize(d: SettingDescriptor, raw: unknown): string {
  if (d.type === 'boolean') return raw === true || raw === 'true' ? 'true' : 'false'
  return raw === undefined || raw === null ? '' : String(raw)
}

export async function setSettings(
  updates: Record<string, unknown>,
  actorId: string | null,
): Promise<SetSettingsResult> {
  const errors: Record<string, string> = {}
  const valid: Array<{ d: SettingDescriptor; value: string }> = []

  for (const [key, rawValue] of Object.entries(updates)) {
    const d = getDescriptor(key)
    if (!d) { errors[key] = 'Clé inconnue ou non éditable'; continue }
    if (d.secret) { errors[key] = 'Les secrets ne sont pas gérés en Phase 1'; continue }

    const value = normalize(d, rawValue).trim()
    if (value === '') {
      if (!d.optional) { errors[key] = 'Valeur requise'; continue }
    } else if (d.validate) {
      const err = d.validate(value)
      if (err) { errors[key] = err; continue }
    }
    valid.push({ d, value })
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, applied: [], restartRequired: false }
  }

  const applied: string[] = []
  let restartRequired = false

  for (const { d, value } of valid) {
    const oldValue = process.env[d.key] ?? ''
    if (oldValue === value) continue   // no-op, ne pas logger du bruit

    await db.query(
      `INSERT INTO instance_settings (key, value, is_secret, updated_by, updated_at)
       VALUES ($1, $2, FALSE, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, is_secret = FALSE,
             updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [d.key, value, actorId],
    )

    // Overlay immédiat : tier 3 = effet à chaud. tier ≤ 2 = process.env mis à
    // jour pour cohérence, mais nécessite un redémarrage pour être lu.
    process.env[d.key] = value
    if (d.tier <= 2) restartRequired = true

    applied.push(d.key)
    void auditSettingChange(actorId, d.key, oldValue, value)
  }

  return { ok: true, errors: {}, applied, restartRequired }
}

// ── Audit (réutilise admin_audit_log) ──────────────────────────────────────────

async function auditSettingChange(
  actorId: string | null,
  key: string,
  oldValue: string,
  newValue: string,
): Promise<void> {
  try {
    let actorUsername = 'system'
    if (actorId) {
      const { rows } = await db.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [actorId])
      actorUsername = rows[0]?.username ?? 'unknown'
    }
    await db.query(
      `INSERT INTO admin_audit_log (actor_id, actor_username, action, target_type, target_id, target_label, metadata)
       VALUES ($1, $2, 'settings_update', 'setting', $3, $3, $4)`,
      [actorId, actorUsername, key, JSON.stringify({ from: oldValue, to: newValue })],
    )
  } catch { /* never fail the main operation */ }
}
