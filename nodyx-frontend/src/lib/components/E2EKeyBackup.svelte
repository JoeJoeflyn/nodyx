<script lang="ts">
	import { onMount } from 'svelte'
	import {
		hasServerBackup, canBackupLocalKey, uploadKeyBackup,
		restoreKeyBackup, deleteKeyBackup,
	} from '$lib/e2eBackupClient'

	let { token, mode = 'manage', onDone, onSkip }: {
		token: string
		mode?: 'manage' | 'restore'
		onDone?: () => void
		onSkip?: () => void
	} = $props()

	let phrase  = $state('')
	let phrase2 = $state('')
	let busy    = $state(false)
	let error   = $state('')
	let success = $state('')

	// Manage
	let backupExists = $state(false)
	let canBackup    = $state(true)
	let ready        = $state(false)

	onMount(async () => {
		if (mode === 'manage') {
			backupExists = await hasServerBackup(token)
			canBackup    = await canBackupLocalKey()
		}
		ready = true
	})

	async function setupBackup() {
		error = ''; success = ''
		if (phrase.length < 8) { error = 'La phrase doit faire au moins 8 caractères.'; return }
		if (phrase !== phrase2) { error = 'Les deux phrases ne correspondent pas.'; return }
		busy = true
		try {
			const ok = await uploadKeyBackup(token, phrase)
			if (ok) {
				success = 'Sauvegarde activée. Garde précieusement ta phrase : sans elle, aucune récupération possible.'
				backupExists = true
				phrase = ''; phrase2 = ''
			} else {
				error = 'Échec de la sauvegarde. Réessaie.'
			}
		} catch {
			error = 'Ta clé actuelle ne peut pas être sauvegardée (générée avant cette fonctionnalité).'
		} finally { busy = false }
	}

	async function doRestore() {
		error = ''; success = ''
		if (!phrase) { error = 'Entre ta phrase de récupération.'; return }
		busy = true
		try {
			const ok = await restoreKeyBackup(token, phrase)
			if (ok) { success = 'Clé restaurée. Tes messages chiffrés vont réapparaître.'; onDone?.() }
			else    { error = 'Phrase incorrecte, ou aucune sauvegarde trouvée.' }
		} catch {
			error = 'Échec de la restauration.'
		} finally { busy = false }
	}

	async function removeBackup() {
		busy = true; error = ''; success = ''
		try {
			if (await deleteKeyBackup(token)) { backupExists = false; success = 'Sauvegarde supprimée.' }
		} finally { busy = false }
	}
</script>

<div class="kb">
	{#if mode === 'restore'}
		<div class="kb-head">
			<span class="kb-icon">🔑</span>
			<div>
				<div class="kb-title">Retrouve tes messages chiffrés</div>
				<div class="kb-sub">Nouvel appareil détecté. Entre ta phrase de récupération pour restaurer ta clé et relire ton historique.</div>
			</div>
		</div>
		<input class="kb-input" type="password" placeholder="Phrase de récupération"
			bind:value={phrase} onkeydown={(e) => e.key === 'Enter' && doRestore()} autocomplete="off" />
		{#if error}<div class="kb-error">{error}</div>{/if}
		{#if success}<div class="kb-success">{success}</div>{/if}
		<div class="kb-actions">
			<button class="kb-btn-primary" onclick={doRestore} disabled={busy}>{busy ? '…' : 'Restaurer'}</button>
			<button class="kb-btn-ghost" onclick={() => onSkip?.()} disabled={busy}>Créer une nouvelle identité</button>
		</div>
		<div class="kb-hint">Sans la phrase, l'historique précédent reste illisible (chiffrement de bout en bout).</div>

	{:else}
		<!-- mode manage -->
		<div class="kb-head">
			<span class="kb-icon">🔐</span>
			<div>
				<div class="kb-title">Sauvegarde des messages chiffrés</div>
				<div class="kb-sub">Sauvegarde ta clé E2E, chiffrée par une phrase secrète, pour retrouver tes DMs sur un autre navigateur ou appareil. Le serveur ne voit jamais ta clé.</div>
			</div>
			{#if ready}
				<span class="kb-pill {backupExists ? 'on' : 'off'}">
					<span class="kb-dot"></span>{backupExists ? 'Active' : 'Inactive'}
				</span>
			{/if}
		</div>

		{#if ready && !canBackup}
			<div class="kb-warn">
				Ta clé actuelle a été générée avant cette fonctionnalité et ne peut pas être sauvegardée.
				Elle deviendra sauvegardable à sa prochaine régénération (nouveau navigateur).
			</div>
		{:else if ready}
			<input class="kb-input" type="password" placeholder="Phrase de récupération (8 caractères min.)"
				bind:value={phrase} autocomplete="new-password" />
			<input class="kb-input" type="password" placeholder="Confirme la phrase"
				bind:value={phrase2} autocomplete="new-password" />
			{#if error}<div class="kb-error">{error}</div>{/if}
			{#if success}<div class="kb-success">{success}</div>{/if}
			<div class="kb-actions">
				<button class="kb-btn-primary" onclick={setupBackup} disabled={busy}>
					{busy ? '…' : backupExists ? 'Mettre à jour la phrase' : 'Activer la sauvegarde'}
				</button>
				{#if backupExists}
					<button class="kb-btn-danger" onclick={removeBackup} disabled={busy}>Supprimer</button>
				{/if}
			</div>
			<div class="kb-hint">Choisis une phrase longue et mémorable. Perdue, elle est irrécupérable (zéro-knowledge).</div>
		{/if}
	{/if}
</div>

<style>
	.kb { display: flex; flex-direction: column; gap: 12px; }
	.kb-head { display: flex; align-items: flex-start; gap: 12px; }
	.kb-icon { font-size: 22px; line-height: 1; }
	.kb-title { font-size: 15px; font-weight: 600; color: #fff; }
	.kb-sub { font-size: 13px; color: #94a3b8; margin-top: 2px; line-height: 1.45; }
	.kb-pill { margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
		padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
	.kb-pill.on  { background: rgba(34,197,94,.12);  color: #4ade80; }
	.kb-pill.off { background: rgba(148,163,184,.12); color: #94a3b8; }
	.kb-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
	.kb-input { width: 100%; padding: 10px 12px; border-radius: 10px;
		background: rgba(15,23,42,.6); border: 1px solid rgba(148,163,184,.2);
		color: #f1f5f9; font-size: 14px; outline: none; transition: border-color .15s; }
	.kb-input:focus { border-color: #6366f1; }
	.kb-actions { display: flex; gap: 10px; flex-wrap: wrap; }
	.kb-btn-primary { padding: 9px 16px; border-radius: 10px; border: none; cursor: pointer;
		font-weight: 600; font-size: 14px; color: #fff;
		background: linear-gradient(135deg, #6366f1, #a855f7); transition: transform .12s, opacity .12s; }
	.kb-btn-primary:hover:not(:disabled) { transform: translateY(-1px); }
	.kb-btn-ghost, .kb-btn-danger { padding: 9px 16px; border-radius: 10px; cursor: pointer;
		font-weight: 600; font-size: 14px; background: transparent; }
	.kb-btn-ghost  { border: 1px solid rgba(148,163,184,.3); color: #cbd5e1; }
	.kb-btn-danger { border: 1px solid rgba(239,68,68,.35); color: #f87171; }
	.kb-btn-primary:disabled, .kb-btn-ghost:disabled, .kb-btn-danger:disabled { opacity: .5; cursor: default; }
	.kb-error   { font-size: 13px; color: #f87171; }
	.kb-success { font-size: 13px; color: #4ade80; }
	.kb-warn { font-size: 13px; color: #fbbf24; background: rgba(251,191,36,.08);
		border: 1px solid rgba(251,191,36,.2); border-radius: 10px; padding: 10px 12px; line-height: 1.45; }
	.kb-hint { font-size: 12px; color: #64748b; line-height: 1.4; }
</style>
