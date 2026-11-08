"use client";

import type { ReactNode } from "react";
import type { TogetherT } from "@/components/realtime/messages";
import { Callout } from "@/components/ui";
import { useStdb } from "@/lib/stdb";

/** A same-origin room link as a path the router can push. */
export function roomPath(link: string): string {
  const url = new URL(link);
  return `${url.pathname}${url.search}`;
}

/** Waiting and "realtime server unreachable" states around the tools that run on SpacetimeDB. */
export function StdbGate({ t, notSetUp, children }: { t: TogetherT; notSetUp: string; children: ReactNode }) {
  const { status } = useStdb();
  if (status === "connecting") return <div aria-busy="true" className="h-32 animate-pulse rounded-ink bg-sunken motion-reduce:animate-none" />;
  if (status === "offline") {
    return (
      <Callout variant="quiet" title={t("lobby.notSetUp")}>
        <span className="mt-0.5 block">{notSetUp}</span>
      </Callout>
    );
  }
  return children;
}
