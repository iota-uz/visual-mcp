import { layoutCanvas } from "./layout.js";
import { renderCanvas } from "./render.js";
import type { Theme } from "./themes.js";
import type { CanvasDoc } from "./types.js";

export type CanvasSnapshotTarget =
  | { type: "canvas" }
  | { type: "node"; nodeId: string }
  | { type: "group"; groupId: string }
  | { type: "stage"; stageId: string }
  | { type: "region"; x: number; y: number; width: number; height: number };

/** Builds the immutable, target-aware HTML consumed by every snapshot renderer. */
export function canvasSnapshotEntryHtml(
  doc: CanvasDoc,
  compiledCss = "",
  target?: CanvasSnapshotTarget,
  theme?: Theme,
  themeCss = "",
): string {
  const positioned = layoutCanvas(doc);
  const { html } = renderCanvas(positioned, {
    theme,
    iframeLoading: "eager",
    shouldLoadIframe: target
      ? (node) => {
          if (target.type === "canvas") return true;
          if (target.type === "node") return node.id === target.nodeId;
          if (target.type === "stage") return node.stageId === target.stageId;
          if (target.type === "group") {
            return (
              doc.groups.find((group) => group.id === target.groupId)?.nodeIds.includes(node.id) ??
              false
            );
          }
          return (
            node.x < target.x + target.width &&
            node.x + node.w > target.x &&
            node.y < target.y + target.height &&
            node.y + node.h > target.y
          );
        }
      : undefined,
  });
  return (
    '<!doctype html><html><head><meta charset="utf-8" />' +
    `<style>html,body{margin:0;padding:0}</style><style>${themeCss}</style>` +
    `<style>${compiledCss}</style></head><body>${html}<script>addEventListener('message',function(e){if(!e.data||e.data.type!=='visual-canvas:readiness')return;for(const f of document.querySelectorAll('.vc-kind-iframe iframe'))if(f.contentWindow===e.source){const n=f.closest('.vc-kind-iframe');n.dataset.iframeReadiness=e.data.state;n.dataset.iframeReadinessDetail=typeof e.data.detail==='string'?e.data.detail:'';break}})</script></body></html>`
  );
}
