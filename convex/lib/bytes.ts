/** Web-standard base64 encoding — `Buffer` is a Node global, not guaranteed in Convex's isolate. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}
