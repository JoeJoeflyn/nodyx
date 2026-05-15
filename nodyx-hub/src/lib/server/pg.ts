import pg from 'pg';
import { lookup } from 'dns/promises';
import { lookupIp } from './geo.js';

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    _pool = new Pool({
      host:     process.env.DB_HOST     || '127.0.0.1',
      port:     Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME     || 'nexus',
      user:     process.env.DB_USER     || 'nexus',
      password: process.env.DB_PASSWORD || '',
      max: 5,
    });
  }
  return _pool;
}

export interface DirectoryInstance {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  url: string;
  ip: string | null;
  language: string;
  country: string | null;
  members: number;
  online: number;
  version: string | null;
  status: 'pending' | 'active' | 'inactive' | 'banned';
  last_seen: string | null;
  registered_at: string;
  admin_email: string | null;
  blocked_reason: string | null;
  blocked_at: string | null;
  lat: number | null;
  lng: number | null;
  geo_city: string | null;
  archived_at: string | null;
}

// Par défaut on exclut les instances archivées (vue principale propre).
// Utiliser includeArchived=true pour la section "archivées" séparée.
export async function getAllInstances(opts: { includeArchived?: boolean } = {}): Promise<DirectoryInstance[]> {
  const pool = getPool();
  const where = opts.includeArchived ? '' : 'WHERE archived_at IS NULL';
  const { rows } = await pool.query<DirectoryInstance>(`
    SELECT id, slug, name, description, url, ip, language, country,
           members, online, version, status, last_seen, registered_at,
           admin_email, blocked_reason, blocked_at, lat, lng, geo_city,
           archived_at
    FROM directory_instances
    ${where}
    ORDER BY registered_at DESC
  `);
  return rows;
}

// Archive les instances qui n'ont pas pingé depuis `days` jours.
// Retourne le nombre d'instances archivées + la liste pour log.
export async function archiveInactiveInstances(days: number): Promise<{ count: number; archived: { id: number; name: string; url: string; days_inactive: number }[] }> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: number; name: string; url: string; days_inactive: number }>(`
    UPDATE directory_instances
    SET archived_at = NOW()
    WHERE archived_at IS NULL
      AND (last_seen IS NULL OR last_seen < NOW() - ($1 || ' days')::INTERVAL)
    RETURNING id, name, url,
              EXTRACT(EPOCH FROM (NOW() - COALESCE(last_seen, registered_at)))::int / 86400 AS days_inactive
  `, [days]);
  return { count: rows.length, archived: rows };
}

export async function unarchiveInstance(id: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE directory_instances SET archived_at = NULL WHERE id = $1`,
    [id]
  );
}

// Ping actif depuis Olympus : fetch instance info + DNS lookup + geoip.
// Met à jour last_seen, version, members, online, ET aussi ip + lat + lng +
// geo_city + country quand on peut les résoudre. Au passage, désarchive
// si elle l'était (auto-revival).
export async function pingInstance(id: number): Promise<{ ok: true; version: string | null; members: number; online: number; geo: { ip: string; city: string; country: string } | null } | { ok: false; error: string }> {
  const pool = getPool();
  const { rows: [inst] } = await pool.query<{ url: string }>(
    `SELECT url FROM directory_instances WHERE id = $1`, [id]
  );
  if (!inst) return { ok: false, error: 'Instance introuvable' };
  try {
    // 1. Health check : l'instance répond-elle ?
    const res = await fetch(`${inst.url}/api/v1/instance/info`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Olympus-Hub/1.0' },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json() as {
      version?: string; member_count?: number; online_count?: number;
      // L'instance déclare aussi son country (.env NODYX_COMMUNITY_COUNTRY).
      // C'est la SEULE source fiable quand l'IP publique est anycast
      // (Cloudflare proxy = pas de geoloc précise possible).
      country?: string; language?: string;
    };

    // 2. Geo : DNS lookup du hostname → IP → geoip.
    //    Si le DNS échoue ou geoip ne sait pas, on garde les valeurs DB
    //    existantes via COALESCE.
    let geo: { ip: string; city: string; country: string; lat: number; lng: number } | null = null;
    try {
      const host = new URL(inst.url).hostname;
      // Famille 0 = let dns choose, mais on préfère IPv4 (geoip-lite plus
      // précis sur IPv4 en général). Fallback IPv6 si pas d'IPv4.
      let address: string;
      try {
        const r = await lookup(host, { family: 4 });
        address = r.address;
      } catch {
        const r = await lookup(host, { family: 6 });
        address = r.address;
      }
      const g = lookupIp(address);
      if (g) {
        geo = { ip: address, city: g.city, country: g.country, lat: g.lat, lng: g.lng };
      }
    } catch { /* DNS échoué : on ne touche pas aux champs geo en DB */ }

    // Country : priorité geoip si on en a un (plus précis), sinon ce que
    // l'instance déclare elle-même (fiable mais à la maille pays seulement).
    const finalCountry = geo?.country || data.country || null;

    await pool.query(
      `UPDATE directory_instances
       SET last_seen   = NOW(),
           version     = COALESCE($2, version),
           members     = COALESCE($3, members),
           online      = COALESCE($4, online),
           ip          = COALESCE($5::inet, ip),
           lat         = COALESCE($6, lat),
           lng         = COALESCE($7, lng),
           geo_city    = COALESCE(NULLIF($8, ''), geo_city),
           country     = COALESCE(NULLIF($9, ''), country),
           language    = COALESCE(NULLIF($10, ''), language),
           archived_at = NULL
       WHERE id = $1`,
      [
        id,
        data.version ?? null, data.member_count ?? null, data.online_count ?? null,
        geo?.ip ?? null, geo?.lat ?? null, geo?.lng ?? null,
        geo?.city ?? null, finalCountry, data.language ?? null,
      ]
    );
    return {
      ok: true,
      version: data.version ?? null,
      members: data.member_count ?? 0,
      online:  data.online_count ?? 0,
      geo:     geo ? { ip: geo.ip, city: geo.city, country: geo.country } : null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

// Batch : ping toutes les instances non archivées qui n'ont PAS de lat/lng.
// Useful pour rattraper le legacy (anciennes instances sans IP/coords).
// Sérialisé pour éviter de saturer DNS + le réseau.
export async function geolocateAllMissing(): Promise<{ total: number; updated: number; failed: number }> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM directory_instances
     WHERE archived_at IS NULL AND (lat IS NULL OR lng IS NULL)
     ORDER BY id`
  );
  let updated = 0, failed = 0;
  for (const r of rows) {
    const res = await pingInstance(r.id);
    if (res.ok && res.geo) updated++;
    else failed++;
  }
  return { total: rows.length, updated, failed };
}

export async function blockInstance(id: number, reason: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE directory_instances SET status='banned', blocked_reason=$1, blocked_at=NOW() WHERE id=$2`,
    [reason, id]
  );
}

export async function unblockInstance(id: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE directory_instances SET status='active', blocked_reason=NULL, blocked_at=NULL WHERE id=$1`,
    [id]
  );
}

export async function getStats() {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)                                          AS total,
      COUNT(*) FILTER (WHERE status='active')          AS active,
      COUNT(*) FILTER (WHERE status='banned')          AS banned,
      COALESCE(SUM(members),0)                         AS total_members,
      COALESCE(SUM(online),0)                          AS total_online
    FROM directory_instances
  `);
  return rows[0];
}
