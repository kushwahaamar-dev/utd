"use client";

import { useEffect, useRef } from "react";
import { useMyProgress, useStdb, useStdbActions } from "@/lib/stdb";
import { getSaved } from "./storage";
import { markDoneLocal, setDoneSink } from "./progress";

const KEY = /^[a-z0-9][a-z0-9:._-]{0,95}$/;
// The module allows a burst of 20 progress writes and then one a second.
const BURST = 15;
const GAP_MS = 1_100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Keeps saved progress and the player's progress rows in step. Finished keys
 * are reported as they happen, keys the server already has are added to this
 * browser (so progress follows the identity), and keys only this browser has
 * are sent once after connecting.
 */
export function ProgressBridge() {
  const { status } = useStdb();
  const { recordProgress } = useStdbActions();
  const { keys, ready } = useMyProgress();
  const sent = useRef(new Set<string>());
  const online = status === "online";

  useEffect(() => {
    if (!online) return;
    const send = (key: string) => {
      if (!KEY.test(key) || sent.current.has(key)) return;
      sent.current.add(key);
      recordProgress(key).catch(() => sent.current.delete(key));
    };
    setDoneSink(send);
    return () => setDoneSink(null);
  }, [online, recordProgress]);

  useEffect(() => {
    if (!online || !ready) return;
    for (const key of keys) {
      sent.current.add(key);
      markDoneLocal(key);
    }
    const missing = Object.keys(getSaved().done).filter((key) => KEY.test(key) && !keys.has(key) && !sent.current.has(key));
    if (!missing.length) return;
    let stop = false;
    void (async () => {
      for (const [i, key] of missing.entries()) {
        if (stop) return;
        if (i >= BURST) await sleep(GAP_MS);
        if (stop || sent.current.has(key)) continue;
        sent.current.add(key);
        await recordProgress(key).catch(() => sent.current.delete(key));
      }
    })();
    return () => {
      stop = true;
    };
  }, [online, ready, keys, recordProgress]);

  return null;
}
