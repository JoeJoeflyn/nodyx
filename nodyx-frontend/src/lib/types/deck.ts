// Types partagés Nodyx Deck — utilisés à la fois par DeckPanel (liste) et
// DeckEditor (WYSIWYG). Définis ici pour éviter la divergence entre les
// deux composants (svelte-check les voit comme deux types distincts si on
// les redéclare localement).

export type DeckActionType =
	| 'noop'
	| 'top_clips'
	| 'vod_marker'
	| 'chat_message'
	| 'trigger_command'

export interface DeckAction {
	type:          DeckActionType
	overlayId?:    string
	period?:       '7d' | '30d' | 'all'
	count?:        number
	description?:  string
	text?:         string
	commandName?:  string
}

export interface DeckButton {
	id:        string
	x:         number
	y:         number
	w:         number
	h:         number
	label:     string
	icon:      string
	gradient:  string
	action:    DeckAction
}

export interface DeckLayout {
	rows:     number
	cols:     number
	buttons:  DeckButton[]
}

export interface Deck {
	id:          string
	token:       string
	label:       string
	layout:      DeckLayout
	createdAt:   string
	updatedAt:   string
	lastSeenAt?: string | null
}
