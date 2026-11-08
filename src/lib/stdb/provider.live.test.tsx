// @vitest-environment node
// Hooks against a running server. Node keeps its own WebSocket; a bare jsdom supplies only the DOM React needs.
// Run with: STDB_LIVE=1 npx vitest run src/lib/stdb/provider.live.test.tsx
import { afterAll, describe, expect, it, vi } from "vitest";
// @ts-expect-error jsdom ships no types and @types/jsdom is not installed
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const key of ["window", "document", "HTMLElement", "Node", "MutationObserver"] as const) {
  Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterAll(() => {
  vi.resetModules();
});

async function load(uri: string) {
  vi.stubEnv("NEXT_PUBLIC_STDB_URI", uri);
  return import("./index");
}

describe.skipIf(!process.env.STDB_LIVE)("against a running server (STDB_LIVE=1)", () => {
  it("joins a room another identity made and shows it through the hooks", async () => {
    const { render, waitFor } = await import("@testing-library/react");
    const { StdbProvider, useStdb, useStdbActions, useMe, useRoom, useRoomMembers, useChat, DbConnection } = await load("ws://127.0.0.1:3100");

    // A second identity makes the room over a plain connection.
    const host = await new Promise<InstanceType<typeof DbConnection>>((resolve, reject) => {
      DbConnection.builder()
        .withUri("ws://127.0.0.1:3100")
        .withDatabaseName("iynk")
        .onConnectError((_c, e) => reject(e))
        .onConnect((conn) => {
          conn.subscriptionBuilder().onApplied(() => resolve(conn)).subscribe("SELECT * FROM room");
        })
        .build();
    });
    await host.reducers.createRoom({ lab: "board", itemId: "uno-r3" });
    const code = await waitFor(() => {
      const row = [...host.db.room.iter()].find((r) => host.identity && r.host.isEqual(host.identity));
      if (!row) throw new Error("no room yet");
      return row.code;
    });

    let stdb: ReturnType<typeof useStdbActions> | undefined;
    function Probe() {
      const state = useStdb();
      const { player } = useMe();
      const { room } = useRoom(code);
      const { members } = useRoomMembers(code);
      const { messages } = useChat(code);
      stdb = useStdbActions();
      return <p>{`${state.status}|${player ? "me" : "-"}|${room?.itemId ?? "-"}|${members.length}|${messages.map((m) => m.text).join(",")}`}</p>;
    }
    const view = render(
      <StdbProvider>
        <Probe />
      </StdbProvider>,
    );
    await waitFor(() => expect(view.container.textContent).toBe("online|me|uno-r3|1|"), { timeout: 5000 });
    await stdb!.joinRoom(code);
    await stdb!.sendChat(code, "hello from jsdom", "en");
    await waitFor(() => expect(view.container.textContent).toBe("online|me|uno-r3|2|hello from jsdom"), { timeout: 5000 });
    host.disconnect();
  });
});
