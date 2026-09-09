/** postMessage types between the editor and a sandboxed screen iframe. */
export const IFRAME_HIT_TEST = "visual-canvas:hit-test";
export const IFRAME_HIT_TEST_RESULT = "visual-canvas:hit-test-result";
export const IFRAME_LOCATE = "visual-canvas:locate";
export const IFRAME_LOCATE_RESULT = "visual-canvas:locate-result";
export const IFRAME_HIT_TEST_MS = 120;

export type IframeHit = {
  el: string;
  role: string;
  name: string;
  rect: { x: number; y: number; w: number; h: number };
};

export type IframeContentPoint = {
  /** Layout pixels inside the iframe document viewport. */
  x: number;
  y: number;
  /** 0–1 of the *visual* iframe box in the parent. */
  nx: number;
  ny: number;
};

type IframeBox = {
  getBoundingClientRect(): DOMRect;
  clientWidth: number;
  clientHeight: number;
  closest?: (selector: string) => Element | null;
};

/**
 * Map a parent-frame click onto the iframe's document.
 *
 * The screen sits inside a CSS-scaled shell (`.vc-device-shell` /
 * `.vc-iframe-viewport`). `iframe.getBoundingClientRect()` can ignore that
 * ancestor transform and report the unscaled layout box, which shifts
 * hit-tests toward the left/top of the mockup. The wrapper div's rect is
 * the visual box the pointer actually hit.
 */
export function iframeContentPoint(
  iframe: IframeBox,
  clientX: number,
  clientY: number,
): IframeContentPoint | null {
  const visual = (iframe.closest?.(".vc-iframe-viewport") as IframeBox | null) ?? iframe;
  const rect = visual.getBoundingClientRect();
  const layoutW = iframe.clientWidth;
  const layoutH = iframe.clientHeight;
  if (!(rect.width > 0) || !(rect.height > 0) || !(layoutW > 0) || !(layoutH > 0)) return null;
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null;
  }
  const nx = (clientX - rect.left) / rect.width;
  const ny = (clientY - rect.top) / rect.height;
  return { x: nx * layoutW, y: ny * layoutH, nx, ny };
}

/**
 * Runs inside the sandboxed iframe (same nonce as the readiness bridge).
 * Parent never reads the screen DOM; this is the only hit-test path.
 */
export function iframeHitTestSource(): string {
  return [
    "function vcName(el){",
    "const a=el.getAttribute('aria-label');",
    "if(a&&a.trim())return a.trim().replace(/\\s+/g,' ').slice(0,120);",
    "if(el.labels&&el.labels[0]){const t=(el.labels[0].textContent||'').trim().replace(/\\s+/g,' ');if(t)return t.slice(0,120);}",
    "const ph=el.getAttribute('placeholder');if(ph&&ph.trim())return ph.trim().slice(0,120);",
    "const type=(el.getAttribute('type')||'').toLowerCase();",
    "const val=el.getAttribute('value');",
    "if(val&&(type==='submit'||type==='button'||type==='reset'))return val.trim().slice(0,120);",
    "const alt=el.getAttribute('alt');if(alt&&alt.trim())return alt.trim().slice(0,120);",
    "let own='';for(const n of el.childNodes){if(n.nodeType===3)own+=n.textContent;}",
    "own=own.replace(/\\s+/g,' ').trim();",
    "if(own)return own.slice(0,120);",
    "return ((el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim()).slice(0,120);",
    "}",
    "function vcRole(el){",
    "const r=el.getAttribute('role');if(r)return r;",
    "const tag=el.tagName.toLowerCase();",
    "if(tag==='a')return 'link';if(tag==='button'||tag==='summary')return 'button';",
    "if(tag==='textarea')return 'textbox';if(tag==='select')return 'combobox';",
    "if(tag==='label')return 'label';if(tag==='option')return 'option';",
    "if(/^h[1-6]$/.test(tag))return 'heading';",
    "if(tag==='input'){const t=(el.getAttribute('type')||'text').toLowerCase();",
    "if(t==='button'||t==='submit'||t==='reset')return 'button';",
    "if(t==='checkbox')return 'checkbox';if(t==='radio')return 'radio';",
    "if(t==='range')return 'slider';if(t==='hidden')return '';return 'textbox';}",
    "return tag;}",
    "function vcInteractive(el){",
    "if(!el||el.nodeType!==1)return false;",
    "const tag=el.tagName.toLowerCase();",
    "if(tag==='input'&&(el.getAttribute('type')||'').toLowerCase()==='hidden')return false;",
    "if('a button input select textarea summary label option p'.split(' ').includes(tag))return true;",
    "if(/^h[1-6]$/.test(tag))return true;",
    "const role=el.getAttribute('role');",
    "if(role&&'button link tab menuitem checkbox radio switch textbox searchbox combobox slider option heading'.split(' ').includes(role))return true;",
    "return el.getAttribute('contenteditable')==='true';",
    "}",
    "function vcOwnText(el){",
    "let t='';for(const n of el.childNodes){if(n.nodeType===3)t+=n.textContent;}",
    "t=t.replace(/\\s+/g,' ').trim();",
    "return t.length>0&&t.length<=120;",
    "}",
    "function vcCandidate(el){",
    "return !!(el&&el.getAttribute&&(el.getAttribute('data-vc-id')||vcInteractive(el)||vcOwnText(el)));",
    "}",
    "function vcPick(x,y){",
    "const stack=(document.elementsFromPoint(x,y)||[]).filter(el=>el&&el!==document.documentElement&&el!==document.body);",
    "let best=null,bestArea=Infinity;",
    "for(const el of stack){",
    "if(!vcCandidate(el))continue;",
    "const r=el.getBoundingClientRect();",
    "const area=Math.max(1,r.width*r.height);",
    "if(area<bestArea){best=el;bestArea=area;}",
    "}",
    "if(best)return best;",
    "let el=stack[0]||document.elementFromPoint(x,y);",
    "while(el&&el!==document.documentElement&&el!==document.body){",
    "if(vcCandidate(el))return el;",
    "el=el.parentElement;}",
    "return null;}",
    "function vcHit(el){",
    "if(!el)return null;",
    "const id=el.getAttribute('data-vc-id')||'';",
    "const r=el.getBoundingClientRect();",
    "return {el:id,role:vcRole(el),name:vcName(el),rect:{x:r.x,y:r.y,w:r.width,h:r.height}};",
    "}",
    "addEventListener('message',e=>{",
    "if(e.source!==parent||!e.data)return;",
    "if(e.data.type==='visual-canvas:hit-test'){",
    "const vw=window.innerWidth||document.documentElement.clientWidth;",
    "const vh=window.innerHeight||document.documentElement.clientHeight;",
    "const x=typeof e.data.nx==='number'?e.data.nx*vw:e.data.x;",
    "const y=typeof e.data.ny==='number'?e.data.ny*vh:e.data.y;",
    "parent.postMessage({type:'visual-canvas:hit-test-result',requestId:e.data.requestId,hit:vcHit(vcPick(x,y))},'*');",
    "}",
    "if(e.data.type==='visual-canvas:locate'&&typeof e.data.el==='string'){",
    "let found=null;try{found=document.querySelector('[data-vc-id=\"'+CSS.escape(e.data.el)+'\"]');}catch(err){}",
    "const r=found?found.getBoundingClientRect():null;",
    "parent.postMessage({type:'visual-canvas:locate-result',requestId:e.data.requestId,rect:r?{x:r.x,y:r.y,w:r.width,h:r.height}:null},'*');",
    "}",
    "});",
  ].join("");
}
