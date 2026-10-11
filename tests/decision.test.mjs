import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSelection, canCancel } from '../src/shared/decision.ts'

const makeDecision = (status = 'pending') => ({
  status, options: [{id: 'a', text: 'Alpha'}, {id: 'b', text: 'Beta'}]
})

test('chooses an existing option without edits', () => {
  assert.deepEqual(validateSelection(makeDecision(), 'b'), {option_id: 'b', text: 'Beta', edited: false})
})
test('tracks a human edit', () => {
  assert.deepEqual(validateSelection(makeDecision(), 'a', '  Changed  '), {option_id: 'a', text: 'Changed', edited: true})
})
test('rejects invalid option and blank edited text', () => {
  assert.throws(() => validateSelection(makeDecision(), 'missing'), /Unknown option/)
  assert.throws(() => validateSelection(makeDecision(), 'a', '   '), /Selection text/)
})
test('does not allow resolving or cancelling twice', () => {
  assert.throws(() => validateSelection(makeDecision('confirmed'), 'a'), /confirmed/)
  assert.equal(canCancel(makeDecision('cancelled')), false)
  assert.equal(canCancel(makeDecision()), true)
})
