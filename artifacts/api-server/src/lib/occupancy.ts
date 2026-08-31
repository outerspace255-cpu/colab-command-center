// Single-user occupancy lock for CC+. Only one user may use the app at a time.
// Occupancy is tied to the live runtime session: when a runtime is connected
// and "owns" the seat, any other caller to the occupancy-guarded endpoints gets
// a 503 "system is currently busy. please try again later."
//
// This lock is in-memory and ephemeral — it resets when the runtime goes
// offline (matching the memory layer lifetime).

import { getRuntimeStatus } from "./runtime-store";

export type OccupancyState = {
  busy: boolean;
  ownerId: string | null;
};

export function getOccupancy(): OccupancyState {
  const status = getRuntimeStatus();
  const occupied = Boolean(status.sessionId) && status.state !== "offline";
  return {
    busy: occupied,
    ownerId: occupied ? status.sessionId : null,
  };
}

/**
 * Returns true if the calling session is allowed to proceed. A caller is
 * allowed when the seat is free OR when the caller already owns the seat.
 */
export function canEnter(sessionId?: string | null): boolean {
  const occ = getOccupancy();
  if (!occ.busy) return true;
  return occ.ownerId != null && sessionId != null && occ.ownerId === sessionId;
}
