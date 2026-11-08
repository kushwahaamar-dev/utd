// Step inputs and outputs are stored in the database. Whatever a tool or a model echoes back, a key never goes with it.
const PATTERNS: RegExp[] = [
  /nvapi-[A-Za-z0-9_-]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // a Solana secret key as a JSON array of 64 bytes
  /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/g,
  // a base58 secret key (64 bytes encode to 86..88 characters)
  /\b[1-9A-HJ-NP-Za-km-z]{86,88}\b/g,
  /\b(?:api[_-]?key|secret|token|password)\b(["'\s:=]+)[A-Za-z0-9._~+/=-]{12,}/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const pattern of PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}
