import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllEnvs();
});

async function load(uri: string) {
  vi.stubEnv("NEXT_PUBLIC_STDB_URI", uri);
  return import("./index");
}

describe("StdbProvider", () => {
  it("renders its children and reports not-online when the server is unreachable", async () => {
    const { StdbProvider, useStdb, useRoomMembers, useStdbActions, StdbOfflineError } = await load("ws://127.0.0.1:9");
    let actions: ReturnType<typeof useStdbActions> | undefined;
    function Probe() {
      const stdb = useStdb();
      const { members, ready } = useRoomMembers("abc234");
      actions = useStdbActions();
      return <p>{`${stdb.status}:${members.length}:${ready}`}</p>;
    }
    render(
      <StdbProvider>
        <Probe />
      </StdbProvider>,
    );
    await waitFor(() => expect(screen.getByText(/^(connecting|offline):0:false$/)).toBeTruthy());
    await expect(actions!.createRoom("drone", "quad5")).rejects.toBeInstanceOf(StdbOfflineError);
    // Cursor frames are best effort: offline they vanish quietly.
    expect(() => actions!.sendCursor("abc234", 1, 2)).not.toThrow();
  });

  it("useStdb is safe outside a provider", async () => {
    const { useStdb } = await load("ws://127.0.0.1:9");
    function Probe() {
      return <p>{useStdb().status}</p>;
    }
    render(<Probe />);
    expect(screen.getByText("offline")).toBeTruthy();
  });
});
