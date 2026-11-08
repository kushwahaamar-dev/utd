import { linkMessage } from "../../src/lib/stdb/link-message";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { t } from "spacetimedb/server";
import spacetimedb from "./schema";
import { fail, limit, limitGlobal, requireColor, requireLang, requireName, requirePlayer, type Ctx } from "./util";
import { leaveEveryRoom } from "./rooms";
import { ensureSchedules } from "./schedules";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const onConnect = spacetimedb.clientConnected((ctx) => {
  ensureSchedules(ctx);
  if (ctx.connectionId) {
    const id = ctx.connectionId.toHexString();
    if (!ctx.db.connection.id.find(id)) ctx.db.connection.insert({ id, identity: ctx.sender });
  }
  // A flood of throwaway identities is refused at the door; a returning one is not counted.
  if (!ctx.db.player.identity.find(ctx.sender)) limitGlobal(ctx, "new_identity", 120, 3);
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

/** What the wallet signs to prove it is the caller's: bound to the identity, so a signature cannot be replayed for another one. */
export { linkMessage };

export const linkWallet = spacetimedb.reducer({ wallet: t.string(), signature: t.string() }, (ctx, { wallet, signature }) => {
  limit(ctx, "link_wallet", 5, 0.1);
  if (!BASE58.test(wallet)) fail("that is not a Solana address");
  if (!ownsWallet(wallet, signature, ctx.sender.toHexString())) fail("the wallet signature does not match");
  requirePlayer(ctx);
  // The signature proves ownership, so the wallet moves here if an older identity of the same person held it.
  for (const row of [...ctx.db.playerWallet.wallet.filter(wallet)]) ctx.db.playerWallet.identity.delete(row.identity);
  const row = { identity: ctx.sender, wallet };
  if (ctx.db.playerWallet.identity.find(ctx.sender)) ctx.db.playerWallet.identity.update(row);
  else ctx.db.playerWallet.insert(row);
});

export function ownsWallet(wallet: string, signatureBase58: string, identityHex: string): boolean {
  try {
    const sig = bs58.decode(signatureBase58);
    const key = bs58.decode(wallet);
    if (sig.length !== 64 || key.length !== 32) return false;
    return ed25519.verify(sig, new TextEncoder().encode(linkMessage(identityHex)), key);
  } catch {
    return false;
  }
}

export function walletOf(ctx: Ctx): string | undefined {
  requirePlayer(ctx);
  return ctx.db.playerWallet.identity.find(ctx.sender)?.wallet;
}
