import type { Connection, PublicKey } from "@solana/web3.js";
import { WalletRequiredError, sendAndConfirm, type Signer } from "./actions";
import { entryAddress, enterRaceIx, raceAddress, refundEntryIx } from "./race";

// Race transactions the player's own wallet signs.

/** Pays the entry fee of race `raceId` and registers the wallet as an entrant. */
export async function enterRace(
  connection: Connection,
  wallet: Signer,
  programId: PublicKey,
  raceId: bigint | number,
): Promise<{ signature: string; entry: string }> {
  if (!wallet.publicKey) throw new WalletRequiredError();
  const race = raceAddress(programId, raceId);
  const signature = await sendAndConfirm(connection, wallet, enterRaceIx(programId, race, wallet.publicKey));
  return { signature, entry: entryAddress(programId, race, wallet.publicKey).toBase58() };
}

/** After a cancelled race: takes the entry fee back. */
export async function refundEntry(
  connection: Connection,
  wallet: Signer,
  programId: PublicKey,
  raceId: bigint | number,
): Promise<string> {
  if (!wallet.publicKey) throw new WalletRequiredError();
  return sendAndConfirm(connection, wallet, refundEntryIx(programId, raceAddress(programId, raceId), wallet.publicKey));
}
