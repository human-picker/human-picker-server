import { EventEmitter } from 'node:events'
import { DecisionDatabase } from './db.js'
import type { Decision, DecisionInput, DecisionStatus } from '../shared/decision.js'

export class DecisionService {
  readonly events = new EventEmitter()
  constructor(readonly database: DecisionDatabase) {
    this.events.setMaxListeners(0)
  }
  private notify(decision: Decision): void {
    this.events.emit('change', { id: decision.id, status: decision.status })
  }
  create(input: DecisionInput): Decision {
    const record = this.database.create(input)
    this.notify(record)
    return record
  }
  private sweep(): void {
    for (const id of this.database.expireDue()) this.events.emit('change', {id, status:'expired'})
  }
  get(id: string): Decision | null { this.sweep(); return this.database.get(id) }
  list(status?: DecisionStatus): Decision[] { this.sweep(); return this.database.list(status) }
  resolve(id: string, optionId: string, text?: string): Decision | null {
    this.sweep()
    const record = this.database.resolve(id, optionId, text)
    if (record) this.notify(record)
    return record
  }
  cancel(id: string): Decision | null {
    this.sweep()
    const record = this.database.cancel(id)
    if (record) this.notify(record)
    return record
  }

  async wait(id: string, timeoutMs = 25000): Promise<Decision | null> {
    const existing = this.get(id)
    if (!existing || existing.status !== 'pending') return existing
    return new Promise(resolve => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.events.off('change', onChange)
        resolve(this.get(id))
      }
      const onChange = (event: {id:string}) => { if (event.id === id) finish() }
      const timeout = setTimeout(finish, timeoutMs)
      this.events.on('change', onChange)
      // Close the race window between the first read and event subscription.
      const latest = this.get(id)
      if (!latest || latest.status !== 'pending') finish()
    })
  }
}
