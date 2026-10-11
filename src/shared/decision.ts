export type DecisionStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired'
export type DecisionKind = 'text'
export interface Candidate {
  id: string
  text: string
}
export interface DecisionInput {
  type: DecisionKind
  title: string
  source?: string
  context?: { project?: string; summary?: string }
  options: Candidate[]
  expires_in_seconds?: number
}
export interface Decision {
  id: string
  type: DecisionKind
  title: string
  source: string
  context: { project?: string; summary?: string }
  options: Candidate[]
  status: DecisionStatus
  selection: { option_id: string; text: string; edited: boolean } | null
  created_at: string
  updated_at: string
  expires_at: string
}

export function validateSelection(
  decision: Decision,
  optionId: string,
  editedText?: string
): { option_id: string; text: string; edited: boolean } {
  if (decision.status !== 'pending') throw new Error(`Decision is ${decision.status}`)
  const option = decision.options.find((item) => item.id === optionId)
  if (!option) throw new Error('Unknown option id')
  const text = editedText === undefined ? option.text : editedText.trim()
  if (!text || text.length > 4000) throw new Error('Selection text must contain 1–4000 characters')
  return { option_id: optionId, text, edited: text !== option.text }
}

export function canCancel(decision: Decision): boolean {
  return decision.status === 'pending'
}
