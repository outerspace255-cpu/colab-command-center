// Single-user occupancy lock for CC+. Only one browser session may use the app
// at a time. The lease is in-memory and refreshed by the frontend heartbeat.

import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { getRuntimeStatus } from "./runtime-store";

export const BUSY_MESSAGE = "system is currently busy. please try again later.";
const CLIENT_COOKIE = "ccc_client_id";
const LEASE_MS = 45_000;

type AppSeat = {
  clientId: string;
  lastSeenAt: number;
};

let appSeat: AppSeat | null = null;

export type OccupancyState = {
  busy: boolean;
  ownerId: string | null;
  allowed: boolean;
};

function parseClientCookie(request: Request): string | null {
  const raw = request.headers.cookie ?? "";
  const match = raw.match(/(?:^|;\s*)ccc_client_id=([^;]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function getClientId(request: Request, response: Response): string {
  const existing = parseClientCookie(request);
  if (existing) return existing;

  const clientId = randomUUID();
  const secure =
    request.secure || request.headers["x-forwarded-proto"] === "https";
  const cookie = [
    `${CLIENT_COOKIE}=${encodeURIComponent(clientId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=86400",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
  response.append("Set-Cookie", cookie);
  return clientId;
}

function expireSeatIfNeeded(): void {
  if (appSeat && Date.now() - appSeat.lastSeenAt > LEASE_MS) {
    appSeat = null;
  }
}

export function isSeatBusy(): boolean {
  expireSeatIfNeeded();
  return appSeat !== null;
}

export function claimSeat(clientId: string): boolean {
  expireSeatIfNeeded();
  if (!appSeat) {
    appSeat = { clientId, lastSeenAt: Date.now() };
    return true;
  }
  if (appSeat.clientId === clientId) {
    appSeat.lastSeenAt = Date.now();
    return true;
  }
  return false;
}

export function getOccupancy(clientId?: string): OccupancyState {
  expireSeatIfNeeded();
  const status = getRuntimeStatus();
  const runtimeOccupied = Boolean(status.sessionId) && status.state !== "offline";
  const appOccupied = Boolean(appSeat);
  return {
    busy: appOccupied || runtimeOccupied,
    ownerId: runtimeOccupied ? status.sessionId : null,
    allowed: !appOccupied || appSeat?.clientId === clientId,
  };
}

export function releaseSeat(clientId: string): void {
  if (appSeat?.clientId === clientId) appSeat = null;
}

/**
 * Runtime session guard for command endpoints. Browser-level access is handled
 * by the API middleware, while this preserves the existing runtime ownership
 * check for commands and assistant execution.
 */
export function canEnter(sessionId?: string | null): boolean {
  const status = getRuntimeStatus();
  const runtimeOccupied =
    Boolean(status.sessionId) && status.state !== "offline";
  if (!runtimeOccupied) return true;
  return status.sessionId != null && sessionId != null && status.sessionId === sessionId;
}
