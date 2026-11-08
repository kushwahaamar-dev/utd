"use client";

import { useEffect, useState } from "react";
import type { LabKind } from "@/components/dock/types";
import { useRoom, useRoomMembers, useStdb } from "@/lib/stdb";
import { MAX_PEERS } from "./protocol";

export type ProbeResult =
  | { kind: "found"; lab: LabKind; itemId: string; peers: number }
  | { kind: "empty" }
  | { kind: "full" }
  | { kind: "unknown-item" }
  | { kind: "unavailable" }
  | { kind: "timeout" };

const LABS: readonly string[] = ["board", "robotics", "drone"];
const TIMEOUT_MS = 6000;

/**
 * Looks up which lab item a room code belongs to, for "join by code" in the
 * lobby. `null` while there is no code to look up or the answer isn't in yet.
 */
export function useRoomProbe(code: string | null): ProbeResult | null {
  const { status } = useStdb();
  const { room, ready: roomReady } = useRoom(code);
  const { members, ready: membersReady } = useRoomMembers(code);
  const [timedOut, setTimedOut] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    const timer = setTimeout(() => setTimedOut(code), TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [code]);

  if (!code) return null;
  if (roomReady && membersReady) {
    if (!room || members.length === 0) return { kind: "empty" };
    if (members.length >= MAX_PEERS) return { kind: "full" };
    if (!LABS.includes(room.lab)) return { kind: "unknown-item" };
    return { kind: "found", lab: room.lab as LabKind, itemId: room.itemId, peers: members.length };
  }
  if (status === "offline") return { kind: "unavailable" };
  return timedOut === code ? { kind: "timeout" } : null;
}
