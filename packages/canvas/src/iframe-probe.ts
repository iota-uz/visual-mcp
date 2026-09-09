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

export type IframeHitTestRequest = {
  type: typeof IFRAME_HIT_TEST;
  requestId: string;
  x: number;
  y: number;
};

export type IframeHitTestResult = {
  type: typeof IFRAME_HIT_TEST_RESULT;
  requestId: string;
  hit: IframeHit | null;
};

/**
 * Map a parent-frame click onto the iframe's layout coordinates.
 * The screen is CSS-scaled (`--vc-iframe-scale`); `getBoundingClientRect`
 * is visual, `clientWidth` is the authored viewport.
 */
export function iframeContentPoint(
  iframe: { getBoundingClientRect(): DOMRect; clientWidth: number; clientHeight: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const rect = iframe.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null;
  }
  return {
    x: ((clientX - rect.left) * iframe.clientWidth) / rect.width,
    y: ((clientY - rect.top) * iframe.clientHeight) / rect.height,
  };
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
    "if('a button input select textarea summary label option'.split(' ').includes(tag))return true;",
    "if(/^h[1-6]$/.test(tag))return true;",
    "const role=el.getAttribute('role');",
    "if(role&&'button link tab menuitem checkbox radio switch textbox searchbox combobox slider option heading'.split(' ').includes(role))return true;",
    "return el.getAttribute('contenteditable')==='true';",
    "}",
    "function vcTarget(el){",
    "while(el&&el!==document.documentElement&&el!==document.body){",
    "if(el.getAttribute&&el.getAttribute('data-vc-id'))return el;",
    "if(vcInteractive(el))return el;",
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
    "const from=document.elementFromPoint(e.data.x,e.data.y);",
    "parent.postMessage({type:'visual-canvas:hit-test-result',requestId:e.data.requestId,hit:vcHit(vcTarget(from))},'*');",
    "}",
    "if(e.data.type==='visual-canvas:locate'&&typeof e.data.el==='string'){",
    "let found=null;try{found=document.querySelector('[data-vc-id=\"'+CSS.escape(e.data.el)+'\"]');}catch(err){}",
    "const r=found?found.getBoundingClientRect():null;",
    "parent.postMessage({type:'visual-canvas:locate-result',requestId:e.data.requestId,rect:r?{x:r.x,y:r.y,w:r.width,h:r.height}:null},'*');",
    "}",
    "});",
  ].join("");
}
