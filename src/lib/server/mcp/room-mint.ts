import "server-only";
import { STDB_DB, STDB_URI } from "@/lib/stdb/config";
import { DbConnection, tables } from "@/lib/stdb/bindings";

const STEP_MS = 8000;

function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out`)), STEP_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Makes a room on the module and hands back its code. The module picks the code, so this connects as a
 * throwaway client, creates the room, reads the code back from its own membership and leaves again:
 * the room stays, empty, and the first person to open the link becomes its host. An empty room is
 * swept 30 minutes after its last member left, so a link nobody opens costs nothing for long.
 */
export async function mintRoom(lab: string, itemId: string): Promise<string> {
  const conn = await within(
    new Promise<DbConnection>((resolve, reject) => {
      DbConnection.builder()
        .withUri(STDB_URI)
        .withDatabaseName(STDB_DB)
        .onConnect((c) => resolve(c))
        .onConnectError((_ctx, error) => reject(error))
        .build();
    }),
    "connecting",
  );
  try {
    const me = conn.identity;
    if (!me) throw new Error("the database did not say who we are");
    await within(
      new Promise<void>((resolve, reject) => {
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve())
          .onError((ctx) => reject(ctx.event ?? new Error("subscription failed")))
          .subscribe([tables.myRoomMembers.where((m) => m.identity.eq(me))]);
      }),
      "subscribing",
    );
    const code = new Promise<string>((resolve) => {
      conn.db.myRoomMembers.onInsert((_ctx, row) => resolve(row.roomCode));
    });
    await within(conn.reducers.createRoom({ lab, itemId }), "creating the room");
    const roomCode = await within(code, "reading the room code");
    await within(conn.reducers.leaveRoom({ code: roomCode }), "leaving the room");
    return roomCode;
  } finally {
    conn.disconnect();
  }
}
