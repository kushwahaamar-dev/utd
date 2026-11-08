import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CredentialStamp } from "./CredentialStamp";
import { RaceCard, type RaceCardRace } from "./RaceCard";
import { RaceResult } from "./RaceResult";
import { formatCountdown, formatLap, formatSol, sharePercent } from "./format";

const A = "11111111111111111111111111111112";
const B = "11111111111111111111111111111113";

const race: RaceCardRace = {
  address: "Race1111111111111111111111111111111111111111",
  title: "Neon loop",
  entryLamports: 10_000_000,
  potLamports: BigInt(140_000_000),
  entryCount: 4,
  closesAt: 1_000_000 + 125,
  status: "open",
  top3: [
    { player: A, lapMs: 8123, name: "ana" },
    { player: B, lapMs: 72_345 },
  ],
};

test("formatters", () => {
  expect(formatSol(50_000_000)).toBe("0.05 SOL");
  expect(formatSol(BigInt(1_500_000_000))).toBe("1.5 SOL");
  expect(formatSol(0)).toBe("0 SOL");
  expect(formatSol(5)).toBe("<0.0001 SOL");
  expect(formatLap(8123)).toBe("8.123s");
  expect(formatLap(72_345)).toBe("1:12.345");
  expect(sharePercent(300, 1000)).toBe(30);
  expect(formatCountdown(125)).toBe("2m 05s");
  expect(formatCountdown(0)).toBeNull();
});

test("an open race shows pot, fee, countdown, podium and an enabled button", () => {
  render(<RaceCard race={race} enter="ready" now={1_000_000} />);
  expect(screen.getByText("0.14 SOL")).toBeTruthy();
  expect(screen.getByText("0.01 SOL")).toBeTruthy();
  expect(screen.getByText("2m 05s")).toBeTruthy();
  expect(screen.getByText("ana")).toBeTruthy();
  expect(screen.getByText("1:12.345")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Enter race" }) as HTMLButtonElement).disabled).toBe(false);
});

test("enter button states", () => {
  const { rerender } = render(<RaceCard race={race} enter="no-wallet" now={1_000_000} />);
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("button").textContent).toContain("Connect");
  rerender(<RaceCard race={race} enter="pending" now={1_000_000} />);
  expect(screen.getByRole("button").getAttribute("aria-busy")).toBe("true");
  rerender(<RaceCard race={race} enter="entered" now={1_000_000} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("You are in")).toBeTruthy();
});

test("a settled race links its payout transaction and has no countdown", () => {
  render(<RaceCard race={{ ...race, status: "settled", top3: [], settleSig: "5".repeat(88) }} enter="closed" now={1_000_000} />);
  expect(screen.getByText("No verified times yet")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Payout transaction" }).getAttribute("href")).toContain("explorer.solana.com/tx/");
});

test("RaceResult lists the 50/30/20 split and links the transaction", () => {
  render(
    <RaceResult
      potLamports={1_000_000_000}
      payouts={[
        { player: A, lamports: 500_000_000, lapMs: 8000 },
        { player: B, lamports: 300_000_000 },
        { player: "11111111111111111111111111111114", lamports: 200_000_000 },
      ]}
      signature={"4".repeat(88)}
    />,
  );
  expect(screen.getByText("50%")).toBeTruthy();
  expect(screen.getByText("30%")).toBeTruthy();
  expect(screen.getByText("20%")).toBeTruthy();
  expect(screen.getByText("0.5 SOL")).toBeTruthy();
  expect(screen.getByRole("link", { name: /View transaction/ }).getAttribute("href")).toContain("cluster=devnet");
});

test("CredentialStamp shows the skill, score, date and explorer links", () => {
  render(<CredentialStamp skillId="drone:quad5:safety" title="Quad 5 safety" score={92} issuedAt={1_800_000_000} address={A} signature={"3".repeat(88)} />);
  expect(screen.getByText("Quad 5 safety")).toBeTruthy();
  expect(screen.getByText("92")).toBeTruthy();
  expect(screen.getByText("2027-01-15")).toBeTruthy();
  expect(screen.getAllByRole("link")).toHaveLength(2);
});
