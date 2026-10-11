import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Decision, DecisionInput, DecisionStatus } from '../shared/decision.js'
import { validateSelection } from '../shared/decision.js'
import { randomUUID } from 'node:crypto'

interface DecisionRow {
  id: string
  type: string
  title: string
  source: string
  context_json: string
  options_json: string
  status: DecisionStatus
  selection_json: string | null
  created_at: string
  updated_at: string
  expires_at: string
}

function mapRow(row: DecisionRow): Decision {
  return {
    id: row.id,
    type: 'text',
    title: row.title,
    source: row.source,
    context: JSON.parse(row.context_json) as Decision['context'],
    options: JSON.parse(row.options_json) as Decision['options'],
    status: row.status,
    selection: row.selection_json ? JSON.parse(row.selection_json) as Decision['selection'] : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at
  }
}

export class DecisionDatabase {
  private readonly db: Database.Database
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.db = new Database(join(directory, 'decisions.sqlite'))
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 3000')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        context_json TEXT NOT NULL,
        options_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
        selection_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_status_created ON decisions (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_decisions_expires ON decisions (expires_at) WHERE status = 'pending';
    `)
  }

  create(input: DecisionInput): Decision {
    const id = randomUUID()
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + (input.expires_in_seconds ?? 3600) * 1000).toISOString()
    this.db.prepare(`INSERT INTO decisions
      (id, type, title, source, context_json, options_json, status, selection_json, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?)`)
      .run(id, input.type, input.title, input.source ?? 'unknown-agent',
        JSON.stringify(input.context ?? {}), JSON.stringify(input.options), now, now, expires)
    return this.get(id)!
  }

  get(id: string): Decision | null {
    const row = this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as DecisionRow | undefined
    return row ? mapRow(row) : null
  }

  list(status?: DecisionStatus, limit = 100): Decision[] {
    const query = status
      ? this.db.prepare('SELECT * FROM decisions WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
      : this.db.prepare('SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?').all(limit)
    return (query as DecisionRow[]).map(mapRow)
  }

  resolve(id: string, optionId: string, text?: string): Decision | null {
    return this.db.transaction(() => {
      const decision = this.get(id)
      if (!decision) return null
      const selected = validateSelection(decision, optionId, text)
      const changed = this.db.prepare(`UPDATE decisions SET status = 'confirmed', selection_json = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'`).run(JSON.stringify(selected), new Date().toISOString(), id)
      if (changed.changes !== 1) throw new Error('Decision was already resolved')
      return this.get(id)
    })()
  }

  cancel(id: string): Decision | null {
    return this.db.transaction(() => {
      const existing = this.get(id)
      if (!existing) return null
      if (existing.status !== 'pending') throw new Error(`Decision is ${existing.status}`)
      this.db.prepare(`UPDATE decisions SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'`)
        .run(new Date().toISOString(), id)
      return this.get(id)
    })()
  }

  expireDue(): string[] {
    const now = new Date().toISOString()
    const ids = this.db.prepare("SELECT id FROM decisions WHERE status = 'pending' AND expires_at <= ?")
      .all(now) as Array<{id: string}>
    if (ids.length) this.db.prepare("UPDATE decisions SET status = 'expired', updated_at = ? WHERE status = 'pending' AND expires_at <= ?")
      .run(now, now)
    return ids.map(item => item.id)
  }

  close(): void { this.db.close() }
}
