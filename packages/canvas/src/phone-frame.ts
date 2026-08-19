/** Canonical OSAGO phone chrome, measured from the original index.html. */
export const PHONE_FRAME = {
  width: 310,
  height: 708,
  bezel: 9,
  padding: 4,
  radius: 45,
  screenWidth: 284,
  screenHeight: 682,
  screenRadius: 33,
  statusHeight: 40,
  contentWidth: 284,
  contentHeight: 642,
  notchWidth: 92,
  notchHeight: 25,
  notchRadius: 16,
  captionHeight: 47,
} as const;

export function phoneFrameScale(nodeWidth: number, nodeHeight: number): number {
  return Math.min(
    nodeWidth / PHONE_FRAME.width,
    Math.max(1, nodeHeight - PHONE_FRAME.captionHeight) / PHONE_FRAME.height,
  );
}

export function phoneNodeHeightForWidth(width: number): number {
  return PHONE_FRAME.captionHeight + (width / PHONE_FRAME.width) * PHONE_FRAME.height;
}

const STATUS_ICONS = `<span class="vc-phone-status-icons" aria-hidden="true">
  <svg width="16" height="10" viewBox="0 0 16 10"><rect y="7" width="2.5" height="3" rx="1" fill="#061b36"/><rect x="4.3" y="5" width="2.5" height="5" rx="1" fill="#061b36"/><rect x="8.6" y="2.5" width="2.5" height="7.5" rx="1" fill="#061b36"/><rect x="12.9" width="2.5" height="10" rx="1" fill="#061b36"/></svg>
  <svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M2 4.5a7.1 7.1 0 0110 0M4.2 6.6a4 4 0 015.6 0" stroke="#061b36" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="8.4" r="1.1" fill="#061b36"/></svg>
  <svg width="21" height="10" viewBox="0 0 21 10" fill="none"><rect x=".7" y=".7" width="17" height="8.6" rx="2.4" stroke="#061b36" stroke-opacity=".45" stroke-width="1.2"/><rect x="2.2" y="2.2" width="12.8" height="5.6" rx="1.2" fill="#061b36"/><path d="M19 3.3v3.4" stroke="#061b36" stroke-width="1.5" stroke-linecap="round"/></svg>
</span>`;

/** Canvas-owned phone shell. `screenContent` is the iframe or its placeholder. */
export function renderPhoneFrame(screenContent: string, time: string, scale: number): string {
  return `<div class="vc-phone-shell" style="--vc-phone-scale:${scale}"><div class="vc-phone-screen"><div class="vc-phone-status"><span>${time}</span>${STATUS_ICONS}</div><div class="vc-phone-content"><div class="vc-iframe-viewport" style="width:${PHONE_FRAME.contentWidth}px;height:${PHONE_FRAME.contentHeight}px">${screenContent}</div></div></div></div>`;
}
