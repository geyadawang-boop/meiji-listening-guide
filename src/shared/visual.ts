export type VisualOutputRecovery = 'journal' | 'pending' | 'changed' | 'legacy'

export interface VisualOutputState {
 currentHash?: string
 hasOutput?: boolean
 hasLegacyOutput?: boolean
}

/**
 * Classifies a saved visual task without changing any files.  The caller supplies
 * the digest of the canonical output (when it exists) so this helper stays pure
 * and can also be used by the renderer's tests.
 */
export function visualOutputRecoveryReason(
 task: {
  output?: string
  outputHash?: string
  outputJournal?: unknown
  outputPending?: boolean
  cleaned?: boolean
  frames: Array<{status: string}>
 },
 state: VisualOutputState = {}
): VisualOutputRecovery | undefined {
 if (task.outputJournal) return 'journal'
 if (task.outputPending) return 'pending'
 if (task.output && (!task.outputHash || state.hasOutput !== true || state.currentHash !== task.outputHash))
  return 'changed'
 if (
  (state.hasLegacyOutput || !task.output || task.cleaned !== true) &&
  task.frames.length > 0 &&
  task.frames.every(frame => frame.status === '已完成')
 )
  return 'legacy'
 return undefined
}
