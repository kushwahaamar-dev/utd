"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Identity } from "spacetimedb";
import { SpacetimeDBProvider, useSpacetimeDB } from "spacetimedb/react";
import { DbConnection } from "./bindings";
import { STDB_DB, STDB_URI, clearToken, loadToken, saveToken } from "./config";

export type StdbStatus = "connecting" | "online" | "offline";

export type StdbState = {
  status: StdbStatus;
  identity: Identity | undefined;
  /** The identity as the hex string rooms use for peer ids. */
  identityHex: string | undefined;
  error: string | undefined;
  uri: string;
  db: string;
  /** The raw connection, for code that is not a React component. Null while offline. */
  connection: DbConnection | null;
};

const OFFLINE: StdbState = {
  status: "offline",
  identity: undefined,
  identityHex: undefined,
  error: undefined,
  uri: STDB_URI,
  db: STDB_DB,
  connection: null,
};

const StdbContext = createContext<StdbState>(OFFLINE);

function Bridge({ children }: { children: ReactNode }) {
  const conn = useSpacetimeDB();
  const connection = conn.getConnection() as DbConnection | null;
  const value = useMemo<StdbState>(
    () => ({
      status: conn.isActive ? "online" : conn.connectionError ? "offline" : "connecting",
      identity: conn.identity,
      identityHex: conn.identity?.toHexString(),
      error: conn.connectionError?.message,
      uri: STDB_URI,
      db: STDB_DB,
      connection,
    }),
    [conn.isActive, conn.identity, conn.connectionError, connection],
  );
  return <StdbContext.Provider value={value}>{children}</StdbContext.Provider>;
}

/**
 * Next refuses Math.random() while prerendering, and the SDK draws a throwaway connection id on every render of its
 * provider. The id only matters once connected, so on the server the provider renders with a fixed random.
 */
function PrerenderSafeProvider(props: Parameters<typeof SpacetimeDBProvider<DbConnection>>[0]) {
  if (typeof window !== "undefined") return SpacetimeDBProvider(props);
  const real = Math.random;
  Math.random = () => 0.5;
  try {
    return SpacetimeDBProvider(props);
  } finally {
    Math.random = real;
  }
}

/**
 * One WebSocket for the whole app. Put it once near the root. If the server is
 * unreachable the children still render: hooks return empty lists and
 * `useStdb().status` is "offline" while the SDK keeps retrying with backoff.
 */
export function StdbProvider({ children }: { children: ReactNode }) {
  const builder = useMemo(() => {
    const b = DbConnection.builder()
      .withUri(STDB_URI)
      .withDatabaseName(STDB_DB)
      .withToken(typeof window === "undefined" ? undefined : loadToken())
      .onConnect((_conn, _identity, token) => saveToken(token));
    // A token the server no longer knows (after a reset) would fail forever; start over anonymously.
    b.onConnectError(() => {
      clearToken();
      b.withToken(undefined);
    });
    return b;
  }, []);
  return (
    <PrerenderSafeProvider connectionBuilder={builder}>
      <Bridge>{children}</Bridge>
    </PrerenderSafeProvider>
  );
}

/** Connection status and identity. Safe anywhere: outside a provider it reports "offline". */
export function useStdb(): StdbState {
  return useContext(StdbContext);
}
