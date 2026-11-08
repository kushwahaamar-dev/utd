import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import common from "@/i18n/messages/en/common.json";
import en from "./messages/en.json";

const me = { isEqual: (other: unknown) => other === "me" };
const stdb = vi.hoisted(() => ({
  state: { status: "online" as "online" | "offline" | "connecting", identity: undefined as unknown },
  board: { entries: [] as unknown[], ready: true },
  players: { rows: [] as unknown[], ready: true },
  activity: { totals: {} as Record<string, number>, minutes: [] as unknown[], ready: true },
}));

vi.mock("@/lib/stdb", () => ({
  useStdb: () => stdb.state,
  useLeaderboard: () => stdb.board,
  usePlayers: () => stdb.players,
  useLiveActivity: () => stdb.activity,
}));

const lap = (name: string, bestMs: number, mine = false) => ({
  identity: { isEqual: () => mine },
  name,
  bestMs,
});

async function mount(node: "board" | "live") {
  const { I18nProvider } = await import("@/i18n/client");
  const { Leaderboard, LiveCounter } = await import("./index");
  return render(
    <I18nProvider locale="en" messages={common.client}>
      {node === "board" ? (
        <Leaderboard course="quad5-bando" courseLabel="Bando" messages={en.leaderboard} limit={3} />
      ) : (
        <LiveCounter messages={en.live} />
      )}
    </I18nProvider>,
  );
}

beforeEach(() => {
  stdb.state = { status: "online", identity: me };
  stdb.board = { entries: [], ready: true };
  stdb.players = { rows: [], ready: true };
  stdb.activity = { totals: {}, minutes: [], ready: true };
});

describe("Leaderboard", () => {
  it("shows the top rows and the pilot's own place below them", async () => {
    stdb.board.entries = [lap("Ada", 41_002), lap("", 43_500), lap("Grace", 44_000), lap("Linus", 47_000), lap("Me", 51_250, true)];
    await mount("board");
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByText("Anonymous pilot")).toBeTruthy();
    expect(screen.getByText("41.002s")).toBeTruthy();
    expect(screen.queryByText("Linus")).toBeNull();
    expect(screen.getByText("Me").closest("tr")?.getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("Your rank: #5")).toBeTruthy();
    expect(screen.getByText("5 pilots on the board")).toBeTruthy();
  });

  it("has a real empty state", async () => {
    await mount("board");
    expect(screen.getByText(en.leaderboard.empty)).toBeTruthy();
  });

  it("shows a loading state until the subscription answers", async () => {
    stdb.board.ready = false;
    await mount("board");
    expect(screen.getByText(en.leaderboard.loading)).toBeTruthy();
  });

  it("says when the realtime server is unreachable", async () => {
    stdb.state = { status: "offline", identity: undefined };
    await mount("board");
    expect(screen.getByText(en.leaderboard.offTitle)).toBeTruthy();
  });
});

describe("LiveCounter", () => {
  const minuteAgo = (n: number) => ({ minute: { microsSinceUnixEpoch: BigInt(Date.now() - n * 60_000) * 1000n }, count: 3 });

  it("shows the three counters with plural labels and the activity strip", async () => {
    stdb.players.rows = [{ online: true }, { online: true }, { online: false }];
    stdb.activity = { totals: { "led.blink": 1204, "flight.start": 1 }, minutes: [minuteAgo(2), minuteAgo(0)], ready: true };
    await mount("live");
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("builders")).toBeTruthy();
    expect(screen.getByText("1,204")).toBeTruthy();
    expect(screen.getByText("drone flown")).toBeTruthy();
    expect(screen.getByRole("img", { name: en.live.chart })).toBeTruthy();
  });

  it("invites the first builder when the hour is quiet", async () => {
    await mount("live");
    expect(screen.getByText(en.live.quiet)).toBeTruthy();
  });

  it("says when the realtime server is unreachable", async () => {
    stdb.state = { status: "offline", identity: undefined };
    await mount("live");
    expect(screen.getByText(en.live.offTitle)).toBeTruthy();
  });
});
