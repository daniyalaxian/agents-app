/**
 * Per-room run locks (ENT-8).
 * Different slots run in parallel. The same slot is serialized through a queue
 * so approve/retry/DM on a busy room wait their turn instead of 409'ing the whole server.
 */

export type RunKind = "pipeline" | "dm" | "group"

export type ActiveRun = {
  slot: string
  kind: RunKind
  runId: string
  startedAt: string
}

type SlotState = {
  active: ActiveRun | null
  /** Tail of the serial queue for this slot. */
  tail: Promise<void>
}

const slots = new Map<string, SlotState>()

function stateFor(slot: string): SlotState {
  let state = slots.get(slot)
  if (!state) {
    state = { active: null, tail: Promise.resolve() }
    slots.set(slot, state)
  }
  return state
}

/** True while this room has a live pipeline, DM, or group run. */
export function isRoomBusy(slot: string): boolean {
  return Boolean(stateFor(slot).active)
}

export function listActiveRuns(): ActiveRun[] {
  return [...slots.values()].flatMap((state) => (state.active ? [state.active] : []))
}

/**
 * Run `work` exclusively for `slot`. Callers for other slots are not blocked.
 * A second caller for the same slot waits until the first finishes (queue).
 */
export async function withRoomLock<T>(
  slot: string,
  kind: RunKind,
  work: (runId: string) => Promise<T>,
): Promise<T> {
  if (!slot) throw new Error("Room slot is required for a run lock")
  const state = stateFor(slot)
  const runId = crypto.randomUUID()
  const previous = state.tail
  let release!: () => void
  const done = new Promise<void>((resolve) => {
    release = resolve
  })
  state.tail = previous.then(() => done)

  await previous
  state.active = { slot, kind, runId, startedAt: new Date().toISOString() }
  try {
    return await work(runId)
  } finally {
    if (state.active?.runId === runId) state.active = null
    release()
  }
}

/** Test helper: clear all locks (do not call from the server). */
export function resetRunLocksForTests(): void {
  slots.clear()
}
