import { t } from "spacetimedb/server";
import spacetimedb from "./schema";
import { fail, limit, requireColor, requireLang, requireName, requirePlayer, type Ctx } from "./util";
import { leaveEveryRoom } from "./rooms";
import { ensureSchedules } from "./schedules";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const onConnect = spacetimedb.clientConnected((ctx) => {
  ensureSchedules(ctx);
  if (ctx.connectionId) {
    const id = ctx.connectionId.toHexString();
    if (!ctx.db.connection.id.find(id)) ctx.db.connection.insert({ id, identity: ctx.sender });
  }
  const player = requirePlayer(ctx);
  ctx.db.player.identity.update({ ...player, online: true, lastSeen: ctx.timestamp });
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  if (ctx.connectionId) ctx.db.connection.id.delete(ctx.connectionId.toHexString());
  const stillHere = ctx.db.connection.identity.filter(ctx.sender).next().done === false;
  if (stillHere) return;
  const row = ctx.db.player.identity.find(ctx.sender);
  if (row) ctx.db.player.identity.update({ ...row, online: false, lastSeen: ctx.timestamp });
  leaveEveryRoom(ctx, ctx.sender);
});

export const setProfile = spacetimedb.reducer(
  { name: t.string(), color: t.string(), lang: t.string() },
  (ctx, { name, color, lang }) => {
    limit(ctx, "set_profile", 10, 0.5);
    const player = requirePlayer(ctx);
    const next = { ...player, name: requireName(name), color: requireColor(color), lang: requireLang(lang) };
    ctx.db.player.identity.update(next);
    for (const member of [...ctx.db.roomMember.identity.filter(ctx.sender)]) {
      ctx.db.roomMember.id.update({ ...member, name: next.name, color: next.color });
    }
  },
);

export const linkWallet = spacetimedb.reducer({ wallet: t.string() }, (ctx, { wallet }) => {
  limit(ctx, "link_wallet", 5, 0.1);
  if (!BASE58.test(wallet)) fail("that is not a Solana address");
  const player = requirePlayer(ctx);
  ctx.db.player.identity.update({ ...player, wallet });
});

export function walletOf(ctx: Ctx): string | undefined {
  return requirePlayer(ctx).wallet ?? undefined;
}
