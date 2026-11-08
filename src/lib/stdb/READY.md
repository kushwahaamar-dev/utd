# Realtime client (SpacetimeDB) is ready

The module in `spacetime/` implements the whole contract in `docs/ARCHITECTURE.md`; this folder is its client.
Everything below is importable from `@/lib/stdb`.

## Run it locally

```bash
npm run stdb:start      # standalone server on 127.0.0.1:3100, data in spacetime/.data (leave running)
npm run stdb:publish    # build + publish the module as database "iynk" (WORKER_SECRET defaults to dev-worker-secret)
npm run stdb:generate   # only after changing the module: rewrites src/lib/stdb/bindings
npm run stdb:reset      # publish and wipe all data
npm run stdb:logs       # follow module logs
```

Env (all optional): `NEXT_PUBLIC_STDB_URI` (default `ws://127.0.0.1:3100`), `NEXT_PUBLIC_STDB_DB` (default `iynk`).
Never use port 3000 or 3301-3303; the server is on 3100.

## Wiring

```tsx
import { StdbProvider } from "@/lib/stdb";
<StdbProvider>{children}</StdbProvider>   // once, near the root; it is a client component
```

If the server is down, children still render, hooks return empty lists and `useStdb().status` is `"offline"`
while the SDK retries with backoff. The identity token is kept in localStorage (try/catch, works without it).
Hooks other than `useStdb` must be under the provider.

## Hooks (all return `{ ..., ready }`; pass `null` to switch one off)

| Hook | Returns |
|---|---|
| `useStdb()` | `{ status: "connecting"\|"online"\|"offline", identity, identityHex, error, connection }` (safe anywhere) |
| `useMe()` | `{ player }` your `player` row |
| `usePlayers()` | `{ rows }` |
| `useRoom(code)` | `{ room }` (`seq`, `epoch`, `host`, `lab`, `itemId`) |
| `useRoomMembers(code)` | `{ members }` sorted by join order; `baton`, `role` (host\|builder\|spectator), `labRole`, `status`, `done` (JSON) |
| `useRoomActions(code, sinceSeq?)` | `{ actions }` sorted by `seq`; `action` is a JSON string |
| `useRoomSnapshot(code)` | `{ snapshot }` host snapshot (`seq`, `state` JSON) for late joiners; replay actions with `seq > snapshot.seq` |
| `useChat(code)` | `{ messages }` (module keeps the last 200) |
| `useTranslations(code)` | `{ byMessage: Map<messageId, Record<lang, text>> }` |
| `useCursorEvents(code, fn)` / `usePoseEvents(code, fn)` | event tables, callback per frame (not stored) |
| `useLeaderboard(course, limit?)` | `{ entries }` best lap per identity |
| `useLiveActivity(windowMinutes?)` | `{ totals: Record<kind, count>, minutes }` |
| `useBuddies()` | `{ buddies, mine }` (unexpired, yours split out) |
| `useMyProgress()` | `{ keys: Set<string>, rows }` via the `my_progress` view |
| `useMyJobs()`, `useAgentJob(id)`, `useAgentSteps(jobId)`, `useAgentProposals(jobId)` | agent jobs, steps sorted by `idx`, proposals |
| `useRaces()`, `useRaceEntries(raceId)` | races (newest first), entries sorted by `bestMs` |
| `useCredentials(identity \| walletString)` | `{ credentials }` |

Row types are exported too (`Room`, `RoomMember`, `AgentJob`, ...). Column names are camelCase on the client
(`roomCode`, `itemId`, `bestMs`); the database stores them as snake_case. u64 columns are `bigint`.
Peer ids in the old protocol are `identity.toHexString()`.

## Actions: `const stdb = useStdbActions()`

Each rejects with the module's message when a rule refuses it (`room_full`, `kicked`, `wrong_item`, `no_baton`,
`not_shared`, `rate limited: ...`) and with `StdbOfflineError` while disconnected. `sendCursor` and `sendPose` never throw.

```
setProfile({ name, color, lang })     linkWallet(wallet)
createRoom(lab, itemId)               joinRoom(code, { lab, itemId }?)   leaveRoom(code)
submitAction(code, { type, ... })     postSnapshot(code, seq, state)     sendChat(code, text, lang, kind?)
setPresence(code, { role?, labRole?, status?, name?, done? })
passBaton(code, toIdentity | null)    kick(code, identity)
sendCursor(code, x, y)                sendPose(code, { p, q, v?, gate? })
recordProgress(key)                   trackActivity(kind, count?)        submitLap({ course, timeMs, inputs, name? })
upsertBuddy({ name, lang, interests, built, wants })                     deleteBuddy()
startAgentJob({ kind, goal, context?, roomCode? })   cancelAgentJob(id)  resolveProposal(id, accept)
enterRace(raceId, enterSig)           submitRun({ kind, itemId, sub?, run })
translateMessage(messageId, lang)  -> { ok, data } | { ok: false, error }   (error starts with "not configured" without a key)
searchOffers(query, source?)       -> same shape, data is Offer[]
searchWeb(query)                   -> same shape, data is { title, url, snippet }[]
```

## Rules the module enforces (so the client does not have to)

- Rooms: 6-char code, max 8 members, one lab item per room, first member is host, host leaves -> longest-standing
  member becomes host. Every accepted action gets the next per-room `seq`. Gated actions (everything not "free" in
  `src/lib/realtime/shared-actions.ts`) need the keyboard baton; spectators only send free actions. Baton moves with
  `passBaton`, which also appends a `{type:"room/baton", to, byName, name}` action; asking is `submitAction(code, {type:"room/baton-request"})`.
  Other `room/*` types are refused. `kick` bans the identity from the room.
- Late joiners: read `useRoomSnapshot`, then `useRoomActions(code, snapshot.seq)`. Someone (the host) should call
  `postSnapshot` now and then with the seq they have applied.
- Cursor and pose are capped at 20 Hz per sender (extras are dropped silently).
- `submitRun` replays the run in the module (`drone-safety` only today) and queues an `issue_credential` chain job; it needs a linked wallet.
- Rooms with nobody in them are deleted after 30 min, buddies after 24 h.

`progress` is private; read it only through `useMyProgress()`. Worker-only reducers and how the worker authenticates
are in `spacetime/README.md`.
