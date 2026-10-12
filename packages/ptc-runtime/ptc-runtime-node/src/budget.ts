/**
 * One run's pausable elapsed budget. The clock counts down only while the
 * program's own work runs: a binding call declared in
 * {@link PtcBindingNamespace.pausesBudget} waits on a person rather than on
 * host work, so it pauses the clock and resumes with the time that was left.
 * The budget therefore bounds program progress, not wall-clock time.
 */

/** Milliseconds left on the active clock. */
type Remaining = number

/**
 * Elapsed countdown that a declared external wait can pause.
 *
 * Expiry runs the caller's callback exactly once; a disposed budget never
 * resumes, so late pauses and resumes are no-ops.
 */
export class RunBudget {
  /** Time left when the clock was last disarmed; null disables the deadline. */
  #remaining: Remaining | null
  /** Instant the current armed interval began. */
  #armedAt: number | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  /** Outstanding pauses; the clock runs only while this is zero. */
  #pauses = 0
  #disposed = false
  readonly #expire: () => void

  /**
   * @param timeoutMs - the run's resolved budget, or null for no deadline.
   * @param expire - invoked once when the budget is exhausted.
   */
  constructor(timeoutMs: number | null, expire: () => void) {
    this.#remaining = timeoutMs
    this.#expire = expire
    this.#arm()
  }

  /** Stop counting time; the first outstanding pause disarms the clock. */
  pause(): void {
    if (this.#disposed) return
    this.#pauses += 1
    if (this.#pauses > 1) return
    this.#disarm()
  }

  /** Resume counting with the time left when the last pause began. */
  resume(): void {
    if (this.#disposed || this.#pauses === 0) return
    this.#pauses -= 1
    if (this.#pauses > 0) return
    this.#arm()
  }

  /** Release the timer; later pause/resume calls are no-ops. */
  dispose(): void {
    this.#disposed = true
    this.#disarm()
  }

  #arm(): void {
    if (this.#disposed || this.#remaining === null) return
    this.#armedAt = Date.now()
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      this.#armedAt = undefined
      this.#remaining = 0
      this.#expire()
    }, this.#remaining)
  }

  #disarm(): void {
    if (this.#timer === undefined) return
    clearTimeout(this.#timer)
    this.#timer = undefined
    if (this.#armedAt !== undefined && this.#remaining !== null) {
      this.#remaining = Math.max(0, this.#remaining - (Date.now() - this.#armedAt))
    }
    this.#armedAt = undefined
  }
}
