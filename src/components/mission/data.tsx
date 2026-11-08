"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { cancelDemoRun, demoRunsKey, ensureDemoRun, listDemoRuns, resolveDemoProposal, snapshotFor, startDemoRun, subscribeDemo } from "./mock";
import type { Job, JobKind, Mission } from "./types";

export type StartInput = { kind: JobKind; goal: string; roomCode?: string };

/** What the page needs from a backend. The recorded demo and the live SpacetimeDB client both fit it. */
export type MissionAdapter = {
  mode: "demo" | "live";
  useMission: (jobId: string) => Mission;
  useMyMissions: () => Job[];
  startMission: (input: StartInput) => Promise<string>;
};

const noop = () => {};
const idleMission: Mission = { state: "loading", steps: [], proposals: [], watchers: [], cancel: noop, resolve: noop };
const missingMission: Mission = { ...idleMission, state: "missing" };

export function createDemoAdapter(speed = 1): MissionAdapter {
  return {
    mode: "demo",
    useMission(jobId) {
      const snap = useSyncExternalStore(
        subscribeDemo,
        () => (ensureDemoRun(jobId, speed) ? snapshotFor(jobId) : undefined),
        () => undefined,
      );
      const cancel = useCallback(() => cancelDemoRun(jobId), [jobId]);
      return useMemo(() => {
        if (!snap) return jobId.startsWith("demo") ? idleMission : missingMission;
        return { ...snap, state: "ready" as const, cancel, resolve: resolveDemoProposal };
      }, [snap, cancel, jobId]);
    },
    useMyMissions() {
      const key = useSyncExternalStore(subscribeDemo, demoRunsKey, () => "");
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the key stands for the list
      return useMemo(() => listDemoRuns(), [key]);
    },
    async startMission({ kind, goal, roomCode }) {
      return startDemoRun({ kind, goal, roomCode, speed });
    },
  };
}

const Adapter = createContext<MissionAdapter | null>(null);

export function MissionDataProvider({ adapter, children }: { adapter: MissionAdapter; children: ReactNode }) {
  return <Adapter.Provider value={adapter}>{children}</Adapter.Provider>;
}

function useAdapter(): MissionAdapter {
  const adapter = useContext(Adapter);
  if (!adapter) throw new Error("iynk mission: render inside <MissionDataProvider>.");
  return adapter;
}

export const useMissionMode = () => useAdapter().mode;
export const useMission = (jobId: string): Mission => useAdapter().useMission(jobId);
export const useMyMissions = (): Job[] => useAdapter().useMyMissions();
export const useStartMission = () => useAdapter().startMission;
