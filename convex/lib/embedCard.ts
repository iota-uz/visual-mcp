export interface EmbedCardInput {
  canvasTitle: string;
  version: number;
  targetKind: "canvas" | "node" | "artifact";
  targetLabel: string;
  targetDetail: string;
  imageDataUrl?: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function lines(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const result: string[] = [];
  for (const word of words) {
    const current = result.at(-1);
    if (!current || current.length + word.length + 1 > maxChars) {
      if (result.length === maxLines) break;
      result.push(word);
    } else {
      result[result.length - 1] = `${current} ${word}`;
    }
  }
  if (words.join(" ").length > result.join(" ").length && result.length > 0) {
    const last = result.length - 1;
    result[last] = `${result[last]?.replace(/[.\s]+$/, "") ?? ""}…`;
  }
  return result;
}

function textLines(value: string, x: number, size: number, maxChars: number): string {
  return lines(value, maxChars, 3)
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : Math.round(size * 1.18)}">${escapeXml(line)}</tspan>`,
    )
    .join("");
}

/** A script-free, self-contained image that GitHub's image proxy can cache. */
export function renderEmbedCard(input: EmbedCardInput): string {
  const label = input.targetKind === "node" ? "SCREEN" : input.targetKind.toUpperCase();
  const visual = input.imageDataUrl
    ? `<image href="${escapeXml(input.imageDataUrl)}" x="36" y="36" width="704" height="558" preserveAspectRatio="xMidYMid slice"/>
       <rect x="36" y="438" width="704" height="156" fill="url(#image-fade)"/>`
    : `<rect x="36" y="36" width="704" height="558" fill="url(#empty-bg)"/>
       <g opacity=".9" fill="none" stroke="#9cc8c0" stroke-width="3">
         <path d="M124 196H322V132H526V246H654"/>
         <path d="M122 358H254V292H438V424H646"/>
       </g>
       <g fill="#f7fffd" stroke="#4d8d81" stroke-width="2">
         <rect x="88" y="154" width="154" height="84" rx="18"/>
         <rect x="286" y="92" width="190" height="84" rx="18"/>
         <rect x="492" y="204" width="170" height="84" rx="18"/>
         <rect x="82" y="316" width="190" height="84" rx="18"/>
         <rect x="394" y="382" width="206" height="84" rx="18"/>
       </g>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeXml(input.targetLabel)}">
  <defs>
    <linearGradient id="page" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#f7fbfa"/><stop offset="1" stop-color="#e8f2ef"/>
    </linearGradient>
    <linearGradient id="empty-bg" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#d9eee9"/><stop offset="1" stop-color="#bcded7"/>
    </linearGradient>
    <linearGradient id="image-fade" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#071713" stop-opacity="0"/><stop offset="1" stop-color="#071713" stop-opacity=".72"/>
    </linearGradient>
    <clipPath id="visual-clip"><rect x="36" y="36" width="704" height="558" rx="26"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="url(#page)"/>
  <g clip-path="url(#visual-clip)">${visual}</g>
  <rect x="36" y="36" width="704" height="558" rx="26" fill="none" stroke="#aac9c3"/>

  <g font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">
    <rect x="792" y="54" width="150" height="34" rx="17" fill="#0c5f51"/>
    <text x="867" y="76" fill="#fff" font-size="14" font-weight="800" text-anchor="middle" letter-spacing="1.4">${label}</text>
    <text x="792" y="140" fill="#163c35" font-size="42" font-weight="800">${textLines(input.targetLabel, 792, 42, 18)}</text>
    <text x="792" y="306" fill="#56716c" font-size="19" font-weight="600">${escapeXml(input.targetDetail)}</text>
    <line x1="792" y1="344" x2="1152" y2="344" stroke="#bfd2ce"/>
    <text x="792" y="386" fill="#6d827e" font-size="15" font-weight="700" letter-spacing="1">FROM</text>
    <text x="792" y="425" fill="#183f38" font-size="24" font-weight="750">${textLines(input.canvasTitle, 792, 24, 26)}</text>
    <g transform="translate(792 532)">
      <rect width="42" height="42" rx="12" fill="#123f37"/>
      <path d="M12 13h8v8h-8zm10 0h8v8h-8zM12 23h8v8h-8zm10 0h8v8h-8z" fill="#9ce0d3"/>
      <text x="56" y="18" fill="#163c35" font-size="17" font-weight="800">Visual Canvas</text>
      <text x="56" y="38" fill="#718984" font-size="14">Public preview · v${input.version}</text>
    </g>
  </g>
</svg>`;
}
