// ─── Store global : demande de confirmation pour un lien externe ─────────────
//
// Quand un composant veut ouvrir un lien externe, il appelle requestOpen(url).
// Le composant ExternalLinkWarning monté globalement (dans +layout.svelte)
// écoute ce store et affiche le modal. À l'inverse, dismiss() ferme le modal
// sans naviguer.

import { writable } from 'svelte/store'

export interface PendingLink {
  url:     string
  ts:      number  // pour forcer une re-emission même si la même url ré-arrive
}

export const pendingExternalLink = writable<PendingLink | null>(null)

export function requestOpenExternal(url: string): void {
  pendingExternalLink.set({ url, ts: Date.now() })
}

export function dismissExternalLink(): void {
  pendingExternalLink.set(null)
}
