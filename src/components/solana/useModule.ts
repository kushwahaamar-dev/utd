"use client";

import { useEffect, useMemo } from "react";
import { useTable } from "spacetimedb/react";
import { tables, useMe, useStdb, useStdbActions } from "@/lib/stdb";
import type { ChainJob } from "@/lib/stdb";

export type CredentialJob = { job: ChainJob; status: "queued" | "sent" | "confirmed" | "failed" };

/** Points the signed-in identity at the connected wallet, so the module can issue credentials to it. */
export function useLinkedWallet(wallet: string | null) {
  const { player } = useMe();
  const { linkWallet } = useStdbActions();
  const { status } = useStdb();
  const linked = player?.wallet ?? null;
  useEffect(() => {
    if (status !== "online" || !player || !wallet || linked === wallet) return;
    linkWallet(wallet).catch(() => {});
  }, [status, player, wallet, linked, linkWallet]);
  return linked === wallet && wallet !== null;
}

/** The newest issue_credential job of this identity for one skill, from the public chain_job table. */
export function useCredentialJob(skillId: string): CredentialJob | null {
  const { identityHex } = useStdb();
  const [rows] = useTable(tables.chainJob);
  return useMemo(() => {
    if (!identityHex) return null;
    let best: ChainJob | null = null;
    for (const job of rows) {
      if (job.kind !== "issue_credential") continue;
      try {
        const p = JSON.parse(job.payload) as { identity?: string; skillId?: string };
        if (p.identity !== identityHex || p.skillId !== skillId) continue;
      } catch {
        continue;
      }
      if (!best || job.id > best.id) best = job;
    }
    return best ? { job: best, status: best.status as CredentialJob["status"] } : null;
  }, [rows, identityHex, skillId]);
}
