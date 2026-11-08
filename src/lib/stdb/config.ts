export const STDB_URI = process.env.NEXT_PUBLIC_STDB_URI || "ws://127.0.0.1:3100";
export const STDB_DB = process.env.NEXT_PUBLIC_STDB_DB || "iynk";

const TOKEN_KEY = `iynk:stdb:token:${STDB_DB}`;

/** Storage can throw (private windows, blocked site data); the labs must work without it. */
export function loadToken(): string | undefined {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveToken(token: string) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // The identity lasts for this tab only.
  }
}

export function clearToken() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
