# iynk_passport (Anchor 0.31.1)

One program, two jobs: verified skill credentials with escrowed sponsor bounties, and race prize pools for the drone
gate races. The off-chain oracle (the config's `issuer` key, held by the worker) checks every replay before it signs.

Program id: `BYFLDTLNi946Z8jT4JnxgE8Cpzkr9ud7tSrnThFTv31w` (devnet).

## Accounts

| Account | Seeds | Holds |
| --- | --- | --- |
| `Config` | `["config"]` | admin (upgrade authority), issuer (the oracle) |
| `Credential` | `["cred", learner, skill_hash]` | one verified skill per learner |
| `Bounty` | `["bounty", sponsor, skill_hash, nonce]` | escrowed lamports for a skill |
| `Race` | `["race", race_id u64 LE]` | creator, oracle, entry fee, track hash, close time, status, top 3, pot |
| `Entry` | `["entry", race, player]` | one player's best verified lap, `verified`, `paid` |

A race holds its own pot: rent plus `pot` lamports (seed plus entry fees) sit in the Race PDA until it settles or is
cancelled. `Race.pot` tracks the prize money so rent is never paid out.

## Instructions

Credentials and bounties: `initialize`, `set_issuer`, `issue_credential`, `create_bounty`, `cancel_bounty`.

Races:

- `create_race(race_id, entry_lamports, track_hash, closes_at, seed_lamports)`: anyone creates; the config issuer becomes
  the race's oracle. The entry fee must be at least twice the rent-exempt minimum of an empty account, so every prize
  share can land in a fresh wallet. The creator may seed the pot.
- `enter_race`: the signer pays the fee into the pot. One entry per player, only while the race is open and before `closes_at`.
- `submit_result(lap_ms, run_hash)`: oracle only. Keeps each player's best lap and maintains the ordered top 3.
  A slower lap is accepted as a no-op (`improved = false` in the event).
- `close_race`: oracle only; ends entries now and pulls `closes_at` forward.
- `settle`: after `closes_at`. The oracle can settle at once; anyone can after a one hour grace. Pays 50/30/20 of the
  pot to the podium in one transaction. With fewer finishers the weights renormalise (two finishers: 62.5/37.5, one: 100%);
  first place takes any rounding dust, so payouts always sum to the pot exactly. Remaining accounts: a
  `(winner wallet, winner entry)` pair per podium place, in order, all writable. Fails with `NoFinishers` if nobody has a result.
- `cancel_race`: the oracle (any unfinished race) or the creator (only while empty). The seed returns to the creator at once.
- `refund_entry`: after a cancel, each entrant takes their fee back.

Events: `RaceCreated`, `RaceEntered`, `ResultSubmitted`, `RaceSettled` (with a `RacePayout` per winner), `RaceCancelled`,
`EntryRefunded`, plus `CredentialIssued` and `BountyPaid`.

## Test

```sh
npm ci          # inside solana/
npm test        # anchor test on a local validator; also copies the IDL to ../src/lib/solana/idl
cargo test      # podium ordering and payout math (Rust)
```

`npm test` runs `tests/iynk_passport.test.ts` (credentials, bounties) and `tests/race.test.ts` (races). Race tests wait a
few seconds for `closes_at`, so the suite takes about 90 seconds. They refuse to run against anything but a local validator.

The TypeScript side has its own checks: `npx vitest run src/lib/solana` from the repo root (codec and discriminators against the IDL)
and `cd worker && npx vitest run src/chain` (job processor). The worker end to end test needs a validator and is skipped otherwise:

```sh
solana-keygen new --no-bip39-passphrase --outfile /tmp/admin.json
solana-test-validator --reset --upgradeable-program BYFLDTLNi946Z8jT4JnxgE8Cpzkr9ud7tSrnThFTv31w \
  target/deploy/iynk_passport.so "$(solana-keygen pubkey /tmp/admin.json)"
cd ../worker && CHAIN_E2E_RPC=http://127.0.0.1:8899 CHAIN_E2E_ADMIN=/tmp/admin.json npx vitest run src/chain/e2e
```

## Deploy to devnet

Keys live in `~/.config/solana/iynk` (`deployer.json`, `issuer.json`, `iynk_passport-keypair.json`). Nothing here airdrops;
fund the deployer from <https://faucet.solana.com> if a script says it is short.

```sh
npm run build                 # anchor build + copy the IDL into the app
npm run deploy:devnet         # upgrade the program (extends it if the build grew), update the on-chain IDL,
                              # initialize or rotate the issuer, create a demo race
```

`SKIP_SETUP=1` and `SKIP_DEMO_RACE=1` skip the last two steps. The pieces run on their own:

```sh
node scripts/devnet-setup.ts [--fund-issuer <SOL>] [--set-issuer] [--smoke]
node scripts/devnet-demo-race.ts [--entry 0.01] [--seed 0.02] [--closes-in 1440] [--course quad5-race]
```

The worker needs `SOLANA_ISSUER_KEYPAIR` (the issuer key, base58 or JSON array), `SOLANA_RPC_URL` and
`SOLANA_PROGRAM_ID` (or `NEXT_PUBLIC_SOLANA_PROGRAM_ID`). The issuer also pays the fees of the transactions it sends, so keep
it funded.

## Client code

- `src/lib/solana/race.ts`: PDAs, account decoders, instruction builders, `parseRaceEvents`, `splitPot` (mirrors the Rust payout math), reads (`getRace`, `listRaces`, `getEntries`).
- `src/lib/solana/race-actions.ts`: `enterRace`, `refundEntry` (wallet-adapter signing).
- `worker/src/chain/`: `processChainJob`, `watchProgram`, `replayRecent`, and the helpers that map chain state to the SpacetimeDB worker reducers.
- `src/components/solana/`: `RaceCard`, `RaceResult`, `CredentialStamp` (props only).
