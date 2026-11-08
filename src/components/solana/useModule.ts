"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { useEffect, useMemo, useRef } from "react";
import { useTable } from "spacetimedb/react";
import { tables, useMe, useStdb, useStdbActions } from "@/lib/stdb";
import type { ChainJob } from "@/lib/stdb";
import { linkMessage } from "@/lib/stdb/link-message";

export type CredentialJob = { job: ChainJob; status: "queued" | "sent" | "confirmed" | "failed" };

/** Points the signed-in identity at the connected wallet, so the module can issue credentials to it. The wallet signs a message naming the identity: the module checks it, so nobody can claim an address they do not hold. */
export function useLinkedWallet(wallet: string | null) {
  const { signMessage } = useWallet();
  const { identityHex, status } = useStdb();
  const { linkWallet } = useStdbActions();
  const [rows] = useTable(tables.myWallet);
  const linked = rows[0]?.wallet ?? null;
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "online" || !identityHex || !wallet || linked === wallet || !signMessage) return;
    const attempt = `${identityHex}:${wallet}`;
    if (tried.current === attempt) return;
    tried.current = attempt;
    signMessage(new TextEncoder().encode(linkMessage(identityHex)))
      .then((signature) => linkWallet(wallet, bs58.encode(signature)))
      .catch(() => {});
  }, [status, identityHex, wallet, linked, linkWallet, signMessage]);
  return linked === wallet && wallet !== null;
}

/** The newest issue_credential job of this identity for one skill, from the my_chain_jobs view. */
export function useCredentialJob(skillId: string): CredentialJob | null {
  const { identityHex } = useStdb();
  const [rows] = useTable(tables.myChainJobs);
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
