export function convexSiteOrigin(convexUrl: string | undefined | null): string {
  const raw = (convexUrl ?? "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("VITE_CONVEX_URL is required");
  const url = new URL(raw.replace(/\.convex\.cloud$/, ".convex.site"));
  if (url.port === "3210" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    url.port = "3211";
  }
  return url.origin;
}
