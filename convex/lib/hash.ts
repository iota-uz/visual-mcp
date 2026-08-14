function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 of a UTF-8 string, hex-encoded. Uses Web Crypto (available in Convex's default runtime). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

/**
 * SHA-256 of raw bytes. Needed since files can now arrive as binary — an
 * image fetched by URL or uploaded out of band — not only as UTF-8 text.
 */
export async function sha256HexBytes(input: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", input as BufferSource));
}
