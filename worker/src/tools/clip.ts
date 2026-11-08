const MAX_STRING = 600;
const MAX_ITEMS = 12;
const MAX_DEPTH = 6;

/** Shrinks a tool result before it goes back to the model: long strings and long lists are cut, with a marker. */
export function clip(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}... (${value.length - MAX_STRING} more characters)` : value;
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "(nested data omitted)";
  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ITEMS).map((item) => clip(item, depth + 1));
    return value.length > MAX_ITEMS ? [...head, `(${value.length - MAX_ITEMS} more)`] : head;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clip(item, depth + 1)]));
}

/** JSON for a tool message, held under `maxChars` by cutting lists harder when it is still too long. */
export function toolMessage(value: unknown, maxChars = 6000): string {
  let text = JSON.stringify(clip(value));
  if (text.length <= maxChars) return text;
  text = JSON.stringify(clip(JSON.parse(text), 3));
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}... (cut)`;
}
