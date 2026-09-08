/**
 * Write to the clipboard, and say so when it did not work.
 *
 * The rejection path is real: a non-secure origin or a denied permission
 * both reject, and a caller that ignores that tells the user their token is
 * on the clipboard when it is not.
 *
 * @returns `null` on success, or the reason it failed.
 */
export async function writeClipboard(value: string): Promise<string | null> {
  try {
    await navigator.clipboard.writeText(value);
    return null;
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
