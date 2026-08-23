function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
}

export async function sha256HexBytes(input: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", input as BufferSource));
}
