/**
 * Linkify — convert bare URLs to clickable <a> tags
 *
 * Used in two contexts:
 *  - Chat messages (HTML content from sanitize-html/TipTap): process text nodes only
 *  - Whisper messages (plain text): split approach, no XSS risk
 */

const URL_REGEX = /(https?:\/\/[^\s<>"'{}|\\^`[\]]+)/g

// ── For HTML content (chat) ───────────────────────────────────────────────────
// Replaces bare URLs only inside text nodes (between > and <), skipping anything
// already inside an <a> tag to avoid double-linking.

export function linkifyHtml(html: string): string {
  // Fast-path: if the content contains no URL, skip
  if (!html.includes('http')) return html

  let insideAnchor = 0
  // Process the HTML token by token: tags vs text nodes
  return html.replace(/(<\/?a[\s>])|>([^<]+)</g, (match, anchorTag, textNode) => {
    if (anchorTag) {
      // Track whether we're inside an <a>…</a>
      if (anchorTag.startsWith('</a')) insideAnchor = Math.max(0, insideAnchor - 1)
      else insideAnchor++
      return match
    }
    if (insideAnchor > 0) return match  // don't linkify inside existing <a>
    const linked = textNode.replace(URL_REGEX, (url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-indigo-400 hover:text-indigo-300 underline break-all">${url}</a>`
    )
    return '>' + linked + '<'
  })
}

// ── For plain text (whisper) ──────────────────────────────────────────────────
// Returns an array of segments: { type: 'text'|'url', value: string }
// Rendered safely without XSS (use Svelte {segment.value} for text).

export interface TextSegment { type: 'text'; value: string }
export interface UrlSegment  { type: 'url';  value: string }
export type Segment = TextSegment | UrlSegment

export function linkifyText(content: string): Segment[] {
  const segments: Segment[] = []
  let last = 0
  for (const match of content.matchAll(URL_REGEX)) {
    const start = match.index!
    if (start > last) segments.push({ type: 'text', value: content.slice(last, start) })
    segments.push({ type: 'url', value: match[0] })
    last = start + match[0].length
  }
  if (last < content.length) segments.push({ type: 'text', value: content.slice(last) })
  return segments.length ? segments : [{ type: 'text', value: content }]
}

// ── Version enrichie avec @mentions (utilisée par MessageBody) ───────────────
// Strip trailing punctuation et détecte les mentions @username Nodyx en
// plus des URLs. Le segment 'url' embarque maintenant un `href` distinct du
// `value` (qui est ce qu'on affiche, identique au href pour les URLs nues).

export type ExtSegment =
  | { type: 'text';    value: string }
  | { type: 'url';     value: string; href: string }
  | { type: 'mention'; value: string; username: string }

// Matche les URLs absolues (https://…) ET les paths internes Nodyx
// (/uploads/…), pour rendre cliquables/inline-images les fichiers uploadés
// même quand l'URL est relative.
const URL_RE_TRIMMED  = /(?:\bhttps?:\/\/[^\s<>"']+|\/uploads\/[^\s<>"']+)/gi
const TRAILING_PUNCT  = /[.,;:!?)\]}»>"']+$/
const MENTION_RE      = /(?:^|\s)@([a-zA-Z0-9_-]{2,32})/g

export function linkify(text: string): ExtSegment[] {
  if (!text) return []
  const out: ExtSegment[] = []
  // Pass 1 : URLs (avec strip de la ponctuation finale)
  let lastIndex = 0
  for (const m of text.matchAll(URL_RE_TRIMMED)) {
    const start = m.index ?? 0
    let url = m[0]
    while (TRAILING_PUNCT.test(url)) url = url.replace(TRAILING_PUNCT, '')
    if (start > lastIndex) {
      out.push({ type: 'text', value: text.slice(lastIndex, start) })
    }
    out.push({ type: 'url', value: url, href: url })
    lastIndex = start + url.length
  }
  if (lastIndex < text.length) {
    out.push({ type: 'text', value: text.slice(lastIndex) })
  }
  // Pass 2 : mentions à l'intérieur des segments text
  const final: ExtSegment[] = []
  for (const seg of out) {
    if (seg.type !== 'text') { final.push(seg); continue }
    const t = seg.value
    let li = 0
    for (const mm of t.matchAll(MENTION_RE)) {
      const idx = mm.index ?? 0
      const fullMatch = mm[0]
      const username  = mm[1]
      const leadingWs = fullMatch.startsWith('@') ? '' : fullMatch[0]
      const mentionStart = idx + leadingWs.length
      if (mentionStart > li) {
        final.push({ type: 'text', value: t.slice(li, mentionStart) })
      }
      final.push({ type: 'mention', value: '@' + username, username })
      li = mentionStart + (fullMatch.length - leadingWs.length)
    }
    if (li < t.length) {
      final.push({ type: 'text', value: t.slice(li) })
    }
  }
  return final
}
