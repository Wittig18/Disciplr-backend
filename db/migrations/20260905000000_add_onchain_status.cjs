/**
 * Track on-chain progress separately from the business `vaults.status` enum.
 * A separate column (rather than a new vault_status value) avoids ALTER TYPE ... ADD VALUE inside a
 * migration transaction and keeps every existing status filter/stat unchanged. Values:
 * NULL (simulated vault), 'pending_onchain', 'created' (create_vault confirmed, awaiting stake), 'active'.
 * activity_log gains the ledger the transaction landed in.
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE vaults ADD COLUMN IF NOT EXISTS onchain_status varchar(32)')
  await knex.raw(`ALTER TABLE vaults DROP CONSTRAINT IF EXISTS vaults_onchain_status_check`)
  await knex.raw(`ALTER TABLE vaults ADD CONSTRAINT vaults_onchain_status_check CHECK (onchain_status IS NULL OR onchain_status IN ('pending_onchain','created','active'))`)
  if (await knex.schema.hasTable('activity_log')) {
    await knex.raw('ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS ledger bigint')
  }
}

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('activity_log')) {
    await knex.raw('ALTER TABLE activity_log DROP COLUMN IF EXISTS ledger')
  }
  await knex.raw('ALTER TABLE vaults DROP CONSTRAINT IF EXISTS vaults_onchain_status_check')
  await knex.raw('ALTER TABLE vaults DROP COLUMN IF EXISTS onchain_status')
}
