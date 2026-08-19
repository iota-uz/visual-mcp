import { readFile, writeFile } from "node:fs/promises";
import { CanvasDocSchema, layoutCanvas, renderCanvas } from "../../packages/canvas/dist/index.js";
const doc=CanvasDocSchema.parse(JSON.parse(await readFile(new URL("canvas.json",import.meta.url),"utf8")));
const css=await readFile(new URL("../../packages/canvas/dist/theme.css",import.meta.url),"utf8");
const rendered=renderCanvas(layoutCanvas(doc));
const bridge=`<script>addEventListener('message',e=>{if(!e.data||e.data.type!=='visual-canvas:readiness')return;for(const f of document.querySelectorAll('iframe'))if(f.contentWindow===e.source){const n=f.closest('.vc-kind-iframe');n.dataset.iframeReadiness=e.data.state;n.dataset.iframeReadinessDetail=e.data.detail||''}})</script>`;
// Register before iframe markup so an immediately-ready local screen cannot
// win the event-listener race in this preview/export harness.
await writeFile(new URL("preview.html",import.meta.url),`<!doctype html><meta charset="utf-8"><style>html,body{margin:0}${css}</style>${bridge}${rendered.html}`);
