import { describe, expect, it, vi } from 'vitest'
import { RunBudget } from '../src/budget.ts'

describe('RunBudget', () => {
  it('expires once when the budget runs out', async () => {
    const expire = vi.fn()
    const budget = new RunBudget(20, expire)
    await new Promise((resolve) => { setTimeout(resolve, 60) })
    expect(expire).toHaveBeenCalledTimes(1)
    budget.dispose()
  })

  it('arms no timer without a deadline', async () => {
    const expire = vi.fn()
    const budget = new RunBudget(null, expire)
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    budget.dispose()
    expect(expire).not.toHaveBeenCalled()
  })

  it('holds the countdown while a wait is outstanding and resumes with the time left', () => {
    vi.useFakeTimers()
    try {
      const expire = vi.fn()
      const budget = new RunBudget(100, expire)
      vi.advanceTimersByTime(40)
      budget.pause()
      vi.advanceTimersByTime(1_000)
      budget.resume()
      vi.advanceTimersByTime(50)
      expect(expire).not.toHaveBeenCalled()
      vi.advanceTimersByTime(20)
      expect(expire).toHaveBeenCalledTimes(1)
      budget.dispose()
    } finally { vi.useRealTimers() }
  })

  it('keeps the countdown paused until the last outstanding wait resumes', () => {
    vi.useFakeTimers()
    try {
      const expire = vi.fn()
      const budget = new RunBudget(100, expire)
      budget.pause()
      budget.pause()
      budget.resume()
      vi.advanceTimersByTime(500)
      expect(expire).not.toHaveBeenCalled()
      budget.resume()
      vi.advanceTimersByTime(101)
      expect(expire).toHaveBeenCalledTimes(1)
      budget.dispose()
    } finally { vi.useRealTimers() }
  })

  it('ignores an unbalanced resume and every call after disposal', () => {
    vi.useFakeTimers()
    try {
      const expire = vi.fn()
      const budget = new RunBudget(100, expire)
      budget.resume()
      budget.dispose()
      budget.pause()
      budget.resume()
      vi.advanceTimersByTime(1_000)
      expect(expire).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})
