import { createHmac, randomBytes } from "node:crypto";

const key = randomBytes(32);
/** Opaque byte-page positions cannot be forged; restart requires a fresh read. */
export function sealCursor(payload: Record<string, unknown>) {
  const text = JSON.stringify(payload);
  return Buffer.from(
    JSON.stringify({ text, signature: createHmac("sha256", key).update(text).digest("hex") }),
  ).toString("base64url");
}
export function openCursor(cursor: string): unknown {
  const envelope = JSON.parse(Buffer.from(cursor, "base64url").toString());
  if (
    typeof envelope.text !== "string" ||
    envelope.signature !== createHmac("sha256", key).update(envelope.text).digest("hex")
  )
    throw new Error("Cursor signature invalid or server restarted");
  return JSON.parse(envelope.text);
}
