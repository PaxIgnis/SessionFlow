import { describe, expect, it } from 'vitest'
import { coalesceWhileRunning } from '@/services/utils'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('coalesceWhileRunning', () => {
  it('starts an idle task immediately', async () => {
    let runs = 0
    const run = coalesceWhileRunning(async () => {
      runs += 1
    })

    await run()
    await run()

    expect(runs).toBe(2)
  })

  it('collapses calls made during a run into one follow-up run', async () => {
    const gates: Array<ReturnType<typeof deferred>> = []
    const run = coalesceWhileRunning(() => {
      const gate = deferred()
      gates.push(gate)
      return gate.promise
    })

    const first = run()
    await Promise.resolve()
    const rest = Array.from({ length: 10 }, () => run())
    expect(gates).toHaveLength(1)

    gates[0].resolve()
    await first
    await Promise.resolve()
    await Promise.resolve()
    expect(gates).toHaveLength(2)
    // Every waiting caller shares the follow-up and settles after it.
    let settled = false
    void Promise.all(rest).then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)

    gates[1].resolve()
    await Promise.all(rest)
    expect(gates).toHaveLength(2)
  })

  it('runs the follow-up after a failed run and recovers afterwards', async () => {
    let runs = 0
    const gate = deferred()
    const run = coalesceWhileRunning(async () => {
      runs += 1
      if (runs === 1) await gate.promise
    })

    const first = run()
    const followUp = run()
    gate.reject(new Error('save failed'))

    await expect(first).rejects.toThrow('save failed')
    await followUp
    await run()
    expect(runs).toBe(3)
  })

  it('recovers when the task throws synchronously', async () => {
    let runs = 0
    const run = coalesceWhileRunning(() => {
      runs += 1
      if (runs === 1) throw new Error('boom')
      return Promise.resolve()
    })

    await expect(run()).rejects.toThrow('boom')
    await run()
    expect(runs).toBe(2)
  })
})
