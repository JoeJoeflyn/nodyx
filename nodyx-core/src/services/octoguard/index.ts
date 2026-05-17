/**
 * OctoGuard, modérateur automatique natif Nodyx.
 * Spec : docs/specs/016-Octoguard/016-OctoGuard.md v2.1.1
 *
 * Skeleton de Session A. Logique réelle dans les sessions suivantes :
 *  - Session B : automod matchers + pipeline Socket.IO hook + cache
 *  - Session C : mutes + welcome + commandes + envMigration
 *  - Session D : reports + webhook + admin routes + UI
 *
 * Principes :
 *  - Désactivé par défaut (OCTOGUARD_ENABLED=false ou absent).
 *  - Aucune politique imposée. L'admin construit son cadre.
 *  - Logs unifiés dans admin_audit_log existant (pas de table dédiée).
 *  - Pipeline timeout sécurité 50ms, jamais bloquer le chat.
 */

export * from './types'

/**
 * Vrai si OctoGuard est activé via env. Par défaut false.
 * À call avant tout passage dans le pipeline.
 */
export function isOctoGuardEnabled(): boolean {
  return process.env.OCTOGUARD_ENABLED === 'true'
}

/**
 * Init module au démarrage du backend.
 * Session A : no-op. Sessions ultérieures :
 *  - charger les règles en cache RAM
 *  - s'abonner au Redis pub/sub octoguard:invalidate
 *  - démarrer le worker logs async (RPOP octoguard:logqueue)
 *  - démarrer le worker purge mutes expirés
 *  - migrer BLOCKED_CONTENT_PATTERNS env → DB si vide
 */
export async function initOctoGuard(): Promise<void> {
  if (!isOctoGuardEnabled()) return
  // Session B/C/D : implémenter le wiring complet
}
