// Sliding-window rate limiter + round-robin rotation across a pool of keys.
// Each key has a max requests-per-minute budget; the pool returns the first
// key that is not currently throttled, falling back to the least-recently-used
// throttled key (so callers can still attempt and get a 429 if needed).

import type { PoolConfig } from "./config";

type KeyState = {
  key: string;
  timestamps: number[]; // request start times within the last minute
};

const WINDOW_MS = 60_000;

export class KeyPool {
  private states: KeyState[] = [];
  private cursor = 0;
  readonly limit: number;

  constructor(cfg: PoolConfig) {
    this.limit = cfg.perKeyLimitPerMinute;
    this.states = cfg.keys.map((key) => ({ key, timestamps: [] }));
  }

  get size(): number {
    return this.states.length;
  }

  /** Returns a usable key, or null when the pool is empty. */
  acquire(): string | null {
    if (this.states.length === 0) return null;
    const now = Date.now();
    // Try the next N keys (round robin) looking for one under its limit.
    for (let i = 0; i < this.states.length; i++) {
      const state = this.states[this.cursor % this.states.length];
      this.cursor++;
      this.prune(state, now);
      if (state.timestamps.length < this.limit) {
        state.timestamps.push(now);
        return state.key;
      }
    }
    // All throttled: pick the one whose window will clear soonest.
    let soonest = this.states[0]!;
    let soonestAt = Infinity;
    for (const state of this.states) {
      this.prune(state, now);
      const earliest = state.timestamps[0] ?? now;
      if (earliest < soonestAt) {
        soonestAt = earliest;
        soonest = state;
      }
    }
    // Record the (rate-limited) attempt so callers get backpressure.
    soonest.timestamps.push(now);
    return soonest.key;
  }

  /** Release a key without counting a request (e.g. request failed to send). */
  release(): void {
    // No-op: timestamps already represent actual outgoing requests.
  }

  /** Whether *every* key is at its limit right now. */
  isSaturated(): boolean {
    if (this.states.length === 0) return true;
    const now = Date.now();
    return this.states.every((state) => {
      this.prune(state, now);
      return state.timestamps.length >= this.limit;
    });
  }

  private prune(state: KeyState, now: number): void {
    const cutoff = now - WINDOW_MS;
    // Filter in place.
    let w = 0;
    for (let r = 0; r < state.timestamps.length; r++) {
      if (state.timestamps[r]! >= cutoff) {
        state.timestamps[w++] = state.timestamps[r]!;
      }
    }
    state.timestamps.length = w;
  }
}
