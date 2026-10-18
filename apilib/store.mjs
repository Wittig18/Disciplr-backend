// Data store for the deployed Disciplr API.
// - If DATABASE_URL is set, uses Postgres (the real `vaults` / `milestones` tables created by
//   `npm run migrate:latest`, plus an `activity_log` table created on first use).
// - Otherwise falls back to an in-memory demo store (state resets on cold start).
import { randomUUID, randomBytes } from 'node:crypto'

const DAY = 86400000
const iso = (d) => new Date(d).toISOString()
const hex = (n) => randomBytes(n).toString('hex')

function seed() {
  const now = Date.now()
  const mk = (id, name, creator, amount, status, startOff, endOff, ms) => ({
    id, name, creator, amount: String(amount), status,
    startDate: iso(now + startOff * DAY), endDate: iso(now + endOff * DAY),
    verifier: 'GDLYZ73G3GEF36HBLEBFXOXAP5IXJDRQCRG47JCKR4XAXNOFCU44NZT2',
    successDestination: creator, failureDestination: 'GCAJ2QOEXTR7AB5PJXSAO2HEISE2VEIUIX7CP3F3MOYVX7GMADB7KX22',
    createdAt: iso(now + startOff * DAY), updatedAt: iso(now + startOff * DAY),
    milestones: ms.map((m, i) => ({ id: `${id}-m${i + 1}`, title: m[0], amount: String(m[1]), dueDate: iso(now + m[2] * DAY), status: m[3] })),
  })
  const creator = 'GBVAQKGA5P4TIZSZJBS5AW3XNJOTYG6I3Y5CLIGCBBUZDHMVF7YE7XCQ'
  const vaults = [
    mk('vault-demo-001', 'Launch the MVP', creator, 2500, 'active', -20, 40, [['Ship MVP', 1000, 10, 'completed'], ['Reach 100 users', 1000, 25, 'pending'], ['Public launch', 500, 40, 'pending']]),
    mk('vault-demo-002', 'Finish the thesis', creator, 800, 'completed', -60, -5, [['Finish thesis draft', 400, -30, 'completed'], ['Submit thesis', 400, -5, 'completed']]),
    mk('vault-demo-003', 'Run 3x per week', creator, 1200, 'failed', -90, -10, [['Run 3x per week for 8 weeks', 1200, -10, 'failed']]),
  ]
  const activity = [
    { id: randomUUID(), type: 'create', vaultId: 'vault-demo-001', amount: '2500', status: 'confirmed', hash: hex(32), memo: 'Vault created', createdAt: vaults[0].createdAt },
    { id: randomUUID(), type: 'validate', vaultId: 'vault-demo-001', amount: '1000', status: 'confirmed', hash: hex(32), memo: 'Milestone validated: Ship MVP', createdAt: iso(now - 8 * DAY) },
    { id: randomUUID(), type: 'create', vaultId: 'vault-demo-002', amount: '800', status: 'confirmed', hash: hex(32), memo: 'Vault created', createdAt: vaults[1].createdAt },
    { id: randomUUID(), type: 'release', vaultId: 'vault-demo-002', amount: '800', status: 'confirmed', hash: hex(32), memo: 'Funds released to success destination', createdAt: iso(now - 5 * DAY) },
    { id: randomUUID(), type: 'create', vaultId: 'vault-demo-003', amount: '1200', status: 'confirmed', hash: hex(32), memo: 'Vault created', createdAt: vaults[2].createdAt },
    { id: randomUUID(), type: 'redirect', vaultId: 'vault-demo-003', amount: '1200', status: 'confirmed', hash: hex(32), memo: 'Funds redirected to failure destination', createdAt: iso(now - 10 * DAY) },
  ]
  return { vaults, activity }
}

class MemoryStore {
  kind = 'memory'
  constructor() { const s = seed(); this.vaults = s.vaults; this.activity = s.activity }
  async init() {}
  async listVaults({ creator, status } = {}) {
    return this.vaults.filter((v) => (!creator || v.creator === creator) && (!status || v.status === status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  async getVault(id) { return this.vaults.find((v) => v.id === id) || null }
  async createVault(v) { this.vaults.push(v); return v }
  async saveVault(v) { v.updatedAt = iso(Date.now()); return v }
  async addActivity(a) { this.activity.push(a); return a }
  async listActivity({ vaultId } = {}) {
    return this.activity.filter((a) => !vaultId || a.vaultId === vaultId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  async getActivityByHash(hash) { return this.activity.find((a) => a.hash === hash) || null }
  async saveActivity(a) { return a }
}

class PgStore {
  kind = 'postgres'
  constructor(pool) { this.pool = pool }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS activity_log (
      id uuid PRIMARY KEY, type text NOT NULL, vault_id text NOT NULL, amount numeric(36,7) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'confirmed', hash text NOT NULL, memo text, created_at timestamptz NOT NULL DEFAULT now())`)
    await this.pool.query('ALTER TABLE vaults ADD COLUMN IF NOT EXISTS name varchar(200)')
    await this.pool.query('ALTER TABLE vaults ADD COLUMN IF NOT EXISTS onchain_status varchar(32)')
    await this.pool.query('ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS ledger bigint')
    for (const v of seed().vaults) {
      await this.pool.query('UPDATE vaults SET name=$2 WHERE id=$1 AND name IS NULL', [v.id, v.name])
      await this.pool.query('UPDATE vaults SET creator=$2, verifier=$3, success_destination=$4, failure_destination=$5 WHERE id=$1 AND creator<>$2',
        [v.id, v.creator, v.verifier, v.successDestination, v.failureDestination])
    }
    const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM vaults')
    if (rows[0].n === 0) {
      const s = seed()
      for (const v of s.vaults) await this.createVault(v)
      for (const a of s.activity) await this.addActivity(a)
    }
  }
  rowToVault(r, ms) {
    return {
      id: r.id, name: r.name || `Vault ${r.id}`, creator: r.creator, amount: String(Number(r.amount)), status: r.status, startDate: iso(r.start_date), endDate: iso(r.end_date),
      verifier: r.verifier, successDestination: r.success_destination, failureDestination: r.failure_destination,
      onchainStatus: r.onchain_status || null,
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
      milestones: ms.filter((m) => m.vault_id === r.id).sort((a, b) => a.sort_order - b.sort_order)
        .map((m) => ({ id: m.id, title: m.title, amount: String(Number(m.amount)), dueDate: iso(m.due_date || m.deadline), status: m.status })),
    }
  }
  async listVaults({ creator, status } = {}) {
    const w = ['deleted_at IS NULL']; const p = []
    if (creator) { p.push(creator); w.push(`creator = $${p.length}`) }
    if (status) { p.push(status); w.push(`status = $${p.length}::vault_status`) }
    const { rows } = await this.pool.query(`SELECT * FROM vaults WHERE ${w.join(' AND ')} ORDER BY created_at DESC LIMIT 200`, p)
    if (!rows.length) return []
    const ms = (await this.pool.query('SELECT * FROM milestones WHERE vault_id = ANY($1) AND deleted_at IS NULL', [rows.map((r) => r.id)])).rows
    return rows.map((r) => this.rowToVault(r, ms))
  }
  async getVault(id) {
    const { rows } = await this.pool.query('SELECT * FROM vaults WHERE id = $1 AND deleted_at IS NULL', [id])
    if (!rows[0]) return null
    const ms = (await this.pool.query('SELECT * FROM milestones WHERE vault_id = $1 AND deleted_at IS NULL', [id])).rows
    return this.rowToVault(rows[0], ms)
  }
  async createVault(v) {
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query(`INSERT INTO vaults (id, name, creator, amount, start_date, end_date, verifier, success_destination, failure_destination, status, created_at, updated_at, onchain_status)
        VALUES ($1,$11,$2,$3,$4,$5,$6,$7,$8,$9::vault_status,$10,$10,$12)`,
      [v.id, v.creator, v.amount, v.startDate, v.endDate, v.verifier, v.successDestination, v.failureDestination, v.status, v.createdAt, v.name, v.onchainStatus || null])
      let i = 0
      for (const m of v.milestones) {
        await c.query(`INSERT INTO milestones (id, vault_id, title, target_amount, amount, deadline, due_date, status, sort_order)
          VALUES ($1,$2,$3,$4,$4,$5,$5,$6::milestone_status,$7)`, [m.id, v.id, m.title, m.amount, m.dueDate, m.status, i++])
      }
      await c.query('COMMIT')
    } catch (e) { await c.query('ROLLBACK'); throw e } finally { c.release() }
    return v
  }
  async saveVault(v) {
    await this.pool.query('UPDATE vaults SET status=$2::vault_status, onchain_status=$3, updated_at=now() WHERE id=$1', [v.id, v.status, v.onchainStatus || null])
    for (const m of v.milestones) await this.pool.query('UPDATE milestones SET status=$2::milestone_status, updated_at=now() WHERE id=$1', [m.id, m.status])
    return v
  }
  async addActivity(a) {
    await this.pool.query('INSERT INTO activity_log (id,type,vault_id,amount,status,hash,memo,created_at,ledger) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [a.id, a.type, a.vaultId, a.amount, a.status, a.hash, a.memo, a.createdAt, a.ledger ?? null])
    return a
  }
  actRow(r) { return { id: r.id, type: r.type, vaultId: r.vault_id, amount: String(Number(r.amount)), status: r.status, hash: r.hash, memo: r.memo, ledger: r.ledger == null ? null : Number(r.ledger), createdAt: iso(r.created_at) } }
  async getActivityByHash(hash) {
    const { rows } = await this.pool.query('SELECT * FROM activity_log WHERE hash=$1 LIMIT 1', [hash])
    return rows[0] ? this.actRow(rows[0]) : null
  }
  async saveActivity(a) {
    await this.pool.query('UPDATE activity_log SET status=$2, memo=$3, ledger=$4 WHERE id=$1', [a.id, a.status, a.memo, a.ledger ?? null])
    return a
  }
  async listActivity({ vaultId } = {}) {
    const { rows } = vaultId
      ? await this.pool.query('SELECT * FROM activity_log WHERE vault_id=$1 ORDER BY created_at DESC LIMIT 200', [vaultId])
      : await this.pool.query('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 200')
    return rows.map((r) => this.actRow(r))
  }
}

let storePromise
export function getStore() {
  if (!storePromise) {
    storePromise = (async () => {
      let store
      const url = process.env.DATABASE_URL
      if (url) {
        try {
          const pg = (await import('pg')).default
          const pool = new pg.Pool({ connectionString: url, max: 3, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } })
          store = new PgStore(pool)
          await store.init()
        } catch (e) {
          console.error('Postgres unavailable, falling back to in-memory store:', e.message)
          store = null
        }
      }
      if (!store) { store = new MemoryStore(); await store.init() }
      return store
    })()
  }
  return storePromise
}
