/**
 * Saves a URL as a file with the name the server chose. A plain `<a href
 * download>` is not enough: Convex storage URLs are cross-origin, and the
 * `download` attribute is ignored for those — the browser would navigate
 * to the PNG instead of saving it. Fetching first turns it into a same-origin
 * blob URL the attribute applies to.
 */
export async function downloadUrl(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // The click has already handed the blob to the download manager; the
    // object URL only has to outlive that synchronous handoff.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
