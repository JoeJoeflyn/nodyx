import type { PageServerLoad } from './$types'

// La version est déjà fetchée par le layout server. Cette page n'a besoin
// que d'exposer un éventuel "release URL" et le lien CHANGELOG pour aller
// plus loin si le user clique. Le composant +page.svelte lit data.nodyxVersion
// depuis le layout parent.
export const load: PageServerLoad = async () => {
	return {
		repoUrl:      'https://github.com/Pokled/Nodyx',
		changelogUrl: 'https://github.com/Pokled/Nodyx/blob/main/CHANGELOG.md',
		licenseName:  'AGPL-3.0',
		licenseUrl:   'https://github.com/Pokled/Nodyx/blob/main/LICENSE',
	}
}
