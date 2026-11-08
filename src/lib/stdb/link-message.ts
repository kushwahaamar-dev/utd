/** What a wallet signs to prove it is the caller's. The module builds the same string (spacetime/src/profile.ts). */
export const linkMessage = (identityHex: string) => `iynk: link this wallet to identity ${identityHex}`;
