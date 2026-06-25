import { defineConfig } from 'vitest/config'

// Config Vitest dédiée (séparée de vite.config.ts pour ne pas toucher au build
// SvelteKit). Environnement node : suffisant pour les modules purs (WebCrypto).
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
})
