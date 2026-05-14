// ─── Analyse de risque d'une URL externe ──────────────────────────────────────
//
// Pas une protection magique, c'est un système de freins+pédagogie. On
// signale des indices, on n'affirme pas "ce site est dangereux" car on n'a
// pas de moyen de le savoir. La détection cible 5 patterns connus pour être
// utilisés en phishing :
//   1. URL shortener        (destination cachée)
//   2. IP littérale         (court-circuite le DNS)
//   3. `@` dans l'URL       (RFC 3986 userinfo, presque uniquement phishing)
//   4. IDN mixed-script     (Cyrillique + Latin = homographe)
//   5. Lookalike vs domain populaire (Levenshtein ≤ 2)
//   6. TLD réputé bon marché (.tk, .ml, .ga, .cf, .gq)
//
// On n'aplatit jamais l'URL ni ne suit les redirects ; tout reste 100% côté
// client, en JS pur, zéro call externe.

export type FlagSeverity = 'low' | 'medium' | 'high'

export interface RedFlag {
  type:     'shortener' | 'ip' | 'idn_mixed' | 'lookalike' | 'auth_in_url' | 'suspicious_tld' | 'unusual_chars'
  severity: FlagSeverity
  message:  string
  detail?:  string
}

export interface UrlAnalysis {
  rawUrl:     string
  valid:      boolean
  hostname:   string   // hostname normalisé (Punycode si IDN, lowercase)
  ascii:      string   // hostname ASCII pour comparaisons
  isInternal: boolean  // hostname appartient à l'instance Nodyx ou est relatif
  scheme:     string   // 'https' | 'http' | autre
  port:       string | null
  path:       string
  flags:      RedFlag[]
  highestSeverity: FlagSeverity | null
}

const URL_SHORTENERS = new Set([
  'bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
  'tiny.cc', 'lc.chat', 'shorturl.at', 'rebrand.ly', 'cli.re', 'cutt.ly',
  'rb.gy', 'shorte.st', 'adf.ly', 'bc.vc', 'soo.gd', 'qr.ae', 'v.gd',
  'x.co', 'mcaf.ee', 'su.pr', 's.id', 'lnk.bio', 'fb.me', 'youtu.be',
  // youtu.be n'est pas malveillant en soi mais c'est un shortener par défaut
])

const SUSPICIOUS_TLDS = new Set([
  'tk', 'ml', 'ga', 'cf', 'gq',  // TLDs Freenom historiquement gratuits = phishing massif
  'top', 'work', 'click', 'loan', 'win', 'review', 'country',
])

// Petite liste de domaines à fort risque de typosquatting. On compare en
// distance de Levenshtein ≤ 2. Cette liste n'a pas vocation à être exhaustive,
// elle cible les domaines les plus impersonnés.
const POPULAR_LOOKALIKE_TARGETS = [
  'google.com', 'youtube.com', 'gmail.com', 'facebook.com', 'instagram.com',
  'twitter.com', 'x.com', 'github.com', 'twitch.tv', 'discord.com',
  'amazon.com', 'apple.com', 'microsoft.com', 'paypal.com', 'wikipedia.org',
  'reddit.com', 'linkedin.com', 'tiktok.com', 'whatsapp.com', 'telegram.org',
  'nodyx.org', 'nodyx.dev',
]

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i)
  const curr: number[] = new Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

// Détecte un mélange de scripts dans l'hostname (Cyrillique + Latin, etc.)
// C'est un signal d'IDN homographe (ex: 'аpple.com' avec un 'а' cyrillique).
function hasMixedScripts(hostname: string): boolean {
  // On ignore les chiffres et tirets — ils sont communs à tous les scripts.
  const cleaned = hostname.replace(/[\d.\-_]/g, '')
  if (!cleaned) return false
  let hasLatin = false
  let hasOther = false
  for (const ch of cleaned) {
    const code = ch.codePointAt(0) ?? 0
    if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) {
      hasLatin = true
    } else if (code >= 0x0080) {
      // Tout hors ASCII basique : Cyrillique, Greek, etc.
      hasOther = true
    }
  }
  return hasLatin && hasOther
}

// Hostname IP littérale ? IPv4 ou IPv6 entre crochets.
function isIpHostname(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true   // IPv4
  if (/^\[[0-9a-fA-F:]+\]$/.test(hostname)) return true        // IPv6
  return false
}

// Domain Nodyx-interne : on considère interne le domain de l'instance + sa
// version dev. Les liens relatifs ne passent même pas par l'analyse (gérés
// avant).
function isInternalHostname(hostname: string): boolean {
  if (!hostname) return false
  const h = hostname.toLowerCase()
  if (h === 'nodyx.org' || h.endsWith('.nodyx.org'))   return true
  if (h === 'nodyx.dev' || h.endsWith('.nodyx.dev'))   return true
  if (h === 'localhost') return true
  if (h === '127.0.0.1') return true
  return false
}

function getTld(hostname: string): string | null {
  const parts = hostname.split('.')
  if (parts.length < 2) return null
  return parts[parts.length - 1].toLowerCase()
}

export function analyzeUrl(rawUrl: string): UrlAnalysis {
  const base: UrlAnalysis = {
    rawUrl,
    valid:      false,
    hostname:   '',
    ascii:      '',
    isInternal: false,
    scheme:     '',
    port:       null,
    path:       '',
    flags:      [],
    highestSeverity: null,
  }
  // Lien relatif (commence par /) — interne par construction
  if (rawUrl.startsWith('/') && !rawUrl.startsWith('//')) {
    return { ...base, valid: true, isInternal: true, scheme: '', path: rawUrl }
  }
  let parsed: URL
  try { parsed = new URL(rawUrl) }
  catch { return base }

  base.valid    = true
  base.scheme   = parsed.protocol.replace(':', '')
  base.hostname = parsed.hostname.toLowerCase()
  base.path     = parsed.pathname + parsed.search + parsed.hash
  base.port     = parsed.port || null
  // ASCII form (URL constructor renvoie déjà Punycode pour les IDN)
  base.ascii    = base.hostname

  if (isInternalHostname(base.hostname)) {
    base.isInternal = true
    return base
  }

  const flags: RedFlag[] = []

  // 1. URL shortener
  if (URL_SHORTENERS.has(base.hostname)) {
    flags.push({
      type:     'shortener',
      severity: 'medium',
      message:  `Lien raccourci par ${base.hostname}`,
      detail:   'Tu ne sais pas où ce lien mène vraiment tant que tu ne l’as pas ouvert. Demande à l’expéditeur le lien complet si possible.',
    })
  }

  // 2. IP littérale (court-circuite le DNS, suspect en messagerie)
  if (isIpHostname(base.hostname)) {
    flags.push({
      type:     'ip',
      severity: 'high',
      message:  'Adresse IP brute, sans nom de domaine',
      detail:   'Les sites légitimes utilisent presque toujours un nom de domaine. Un lien par IP est utilisé pour masquer l’identité du site.',
    })
  }

  // 3. `@` ou userinfo dans l'URL : RFC 3986 autorise http://user:pass@host
  //    mais c'est utilisé en quasi-exclusivité pour le phishing (afficher
  //    "nodyx.org" en début, le vrai hostname étant après le @).
  if (parsed.username || parsed.password || /@/.test(rawUrl.split('?')[0].split('#')[0].slice(parsed.protocol.length + 2))) {
    flags.push({
      type:     'auth_in_url',
      severity: 'high',
      message:  'L’URL contient un « @ » avant le vrai nom de domaine',
      detail:   `Le site visité sera ${base.hostname}, pas ce qui apparaît avant le @. C’est une technique classique de phishing.`,
    })
  }

  // 4. IDN mixed scripts
  if (hasMixedScripts(base.hostname)) {
    flags.push({
      type:     'idn_mixed',
      severity: 'high',
      message:  'Le nom de domaine mélange plusieurs alphabets',
      detail:   'Certains caractères de Cyrillique ou Grec sont graphiquement identiques à des lettres Latines mais pointent vers un autre site. Exemple : « аpple.com » avec un « а » cyrillique ≠ « apple.com ».',
    })
  }

  // 5. Lookalike d'un domaine populaire (Levenshtein 1 ou 2)
  for (const target of POPULAR_LOOKALIKE_TARGETS) {
    if (base.hostname === target) continue
    const d = levenshtein(base.hostname, target)
    if (d > 0 && d <= 2) {
      flags.push({
        type:     'lookalike',
        severity: 'high',
        message:  `Ressemble à ${target} mais n’en est pas`,
        detail:   `Différence de ${d} caractère(s). Si tu voulais aller sur ${target}, vérifie l’orthographe du domaine.`,
      })
      break  // un seul lookalike suffit
    }
  }

  // 6. TLD réputé phishing
  const tld = getTld(base.hostname)
  if (tld && SUSPICIOUS_TLDS.has(tld)) {
    flags.push({
      type:     'suspicious_tld',
      severity: 'medium',
      message:  `Extension .${tld} fréquemment utilisée en phishing`,
      detail:   'Ces extensions sont souvent disponibles gratuitement ou à très bas prix, ce qui en fait un choix courant pour les sites jetables.',
    })
  }

  // 7. Caractères confusables visuels en dehors de l'ASCII (ex: O cyrillique
  //    seul, sans mix — non détecté par hasMixedScripts).
  if (/[Ѐ-ӿͰ-Ͽ‐-―]/.test(base.hostname)) {
    flags.push({
      type:     'unusual_chars',
      severity: 'medium',
      message:  'Caractères inhabituels dans le nom de domaine',
      detail:   'Le nom contient des caractères qui peuvent être confondus visuellement avec des lettres Latines.',
    })
  }

  base.flags = flags
  if (flags.length > 0) {
    base.highestSeverity = flags.some(f => f.severity === 'high') ? 'high'
                         : flags.some(f => f.severity === 'medium') ? 'medium'
                         : 'low'
  }
  return base
}

// Helper pour le rendu — sépare hostname et le reste du path pour mise en
// évidence visuelle dans le modal.
export function splitForDisplay(url: string): {
  scheme:    string
  hostname:  string
  pathRest:  string
} {
  try {
    const u = new URL(url)
    return {
      scheme:   u.protocol.replace(':', ''),
      hostname: u.hostname.toLowerCase(),
      pathRest: u.pathname + u.search + u.hash,
    }
  } catch {
    return { scheme: '', hostname: url, pathRest: '' }
  }
}
