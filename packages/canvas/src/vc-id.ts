/**
 * Stable inner-element identity for comments and MCP.
 *
 * `data-vc-id` is the locator (`canvas://ws/c?node=invite&el=submit-claim`).
 * Role + accessible name are what an agent reads. Geometric `local` is only
 * a pin-paint fallback when there is no element (image, PDF, empty padding).
 *
 * Stamp is surgical: it inserts or repairs the attribute on opening tags and
 * leaves the rest of the document byte-identical, so canvas_edit hashes stay
 * stable when ids already exist.
 */

export const VC_ID_ATTR = "data-vc-id";
export const VC_ID_PATTERN = /^[a-z][a-z0-9_-]{0,79}$/;
export const MAX_VC_ID = 80;
export const MAX_VC_NAME = 120;
export const MAX_VC_ROLE = 40;

export type ScreenNode = {
  el: string;
  role: string;
  name: string;
  tag: string;
  children: ScreenNode[];
};

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const RAW_TAGS = new Set(["script", "style", "textarea", "title"]);
const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "label",
  "option",
  "p",
]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "checkbox",
  "radio",
  "switch",
  "textbox",
  "searchbox",
  "combobox",
  "slider",
  "option",
  "listbox",
  "heading",
]);

type Attrs = Record<string, string>;

interface ParsedEl {
  tag: string;
  attrs: Attrs;
  openStart: number;
  openEnd: number;
  selfClosing: boolean;
  parent: ParsedEl | null;
  children: ParsedEl[];
  text: string;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)));
}

function collapseWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function slugifyVcId(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return VC_ID_PATTERN.test(slug) ? slug : "";
}

export function implicitRole(tag: string, inputType?: string): string {
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "label") return "label";
  if (tag === "option") return "option";
  if (HEADING_TAGS.has(tag)) return "heading";
  if (tag === "img") return "img";
  if (tag === "input") {
    const type = (inputType ?? "text").toLowerCase();
    if (type === "button" || type === "submit" || type === "reset") return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "hidden") return "";
    if (type === "file") return "button";
    return "textbox";
  }
  return tag;
}

function skipUntil(html: string, start: number, token: string): number {
  const at = html.indexOf(token, start);
  return at === -1 ? html.length : at + token.length;
}

function parseOpenTag(
  html: string,
  i: number,
): { tag: string; attrs: Attrs; start: number; end: number; selfClosing: boolean } | null {
  if (html[i] !== "<") return null;
  const start = i;
  i += 1;
  const next = html[i];
  if (next === "/" || next === "!" || next === "?" || next === undefined) return null;
  const nameStart = i;
  while (i < html.length && /[A-Za-z0-9:-]/.test(html[i] ?? "")) i += 1;
  const tag = html.slice(nameStart, i).toLowerCase();
  if (!tag) return null;
  const attrs: Attrs = {};
  while (i < html.length) {
    while (i < html.length && /[\s\n\r\t\f]/.test(html[i] ?? "")) i += 1;
    const ch = html[i];
    if (ch === undefined) break;
    if (ch === ">") {
      return { tag, attrs, start, end: i + 1, selfClosing: false };
    }
    if (ch === "/" && html[i + 1] === ">") {
      return { tag, attrs, start, end: i + 2, selfClosing: true };
    }
    const attrStart = i;
    while (i < html.length && /[^\s=>/]/.test(html[i] ?? "")) i += 1;
    const name = html.slice(attrStart, i).toLowerCase();
    while (i < html.length && /[\s\n\r\t\f]/.test(html[i] ?? "")) i += 1;
    if (html[i] === "=") {
      i += 1;
      while (i < html.length && /[\s\n\r\t\f]/.test(html[i] ?? "")) i += 1;
      const quote = html[i];
      let value = "";
      if (quote === '"' || quote === "'") {
        i += 1;
        const valueStart = i;
        while (i < html.length && html[i] !== quote) i += 1;
        value = html.slice(valueStart, i);
        if (html[i] === quote) i += 1;
      } else {
        const valueStart = i;
        while (i < html.length && /[^\s>]/.test(html[i] ?? "")) i += 1;
        value = html.slice(valueStart, i);
      }
      if (name) attrs[name] = decodeEntities(value);
    } else if (name) {
      attrs[name] = "";
    }
  }
  return { tag, attrs, start, end: i, selfClosing: false };
}

function parseDocument(html: string): ParsedEl {
  const root: ParsedEl = {
    tag: "#root",
    attrs: {},
    openStart: 0,
    openEnd: 0,
    selfClosing: false,
    parent: null,
    children: [],
    text: "",
  };
  let current = root;
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch !== "<") {
      const next = html.indexOf("<", i);
      const end = next === -1 ? html.length : next;
      current.text += decodeEntities(html.slice(i, end));
      i = end;
      continue;
    }
    if (html.startsWith("<!--", i)) {
      i = skipUntil(html, i + 4, "-->");
      continue;
    }
    if (html.startsWith("<![CDATA[", i)) {
      i = skipUntil(html, i + 9, "]]>");
      continue;
    }
    if (html.startsWith("<!", i) || html.startsWith("<?", i)) {
      const end = html.indexOf(">", i + 2);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html.startsWith("</", i)) {
      const end = html.indexOf(">", i + 2);
      const raw = html
        .slice(i + 2, end === -1 ? html.length : end)
        .trim()
        .toLowerCase();
      const name = raw.split(/\s/)[0] ?? "";
      i = end === -1 ? html.length : end + 1;
      let cursor: ParsedEl | null = current;
      while (cursor && cursor.tag !== "#root") {
        const parent: ParsedEl | null = cursor.parent;
        if (cursor.tag === name) {
          current = parent ?? root;
          break;
        }
        cursor = parent;
      }
      continue;
    }
    const open = parseOpenTag(html, i);
    if (!open) {
      i += 1;
      continue;
    }
    const node: ParsedEl = {
      tag: open.tag,
      attrs: open.attrs,
      openStart: open.start,
      openEnd: open.end,
      selfClosing: open.selfClosing || VOID_TAGS.has(open.tag),
      parent: current,
      children: [],
      text: "",
    };
    current.children.push(node);
    i = open.end;
    if (RAW_TAGS.has(open.tag) && !node.selfClosing) {
      const close = new RegExp(`</${open.tag}\\s*>`, "i");
      const rest = html.slice(i);
      const match = close.exec(rest);
      const inner = match ? rest.slice(0, match.index) : rest;
      node.text = decodeEntities(inner);
      i = match ? i + match.index + match[0].length : html.length;
      continue;
    }
    if (!node.selfClosing) current = node;
  }
  return root;
}

function walk(el: ParsedEl, visit: (node: ParsedEl) => void): void {
  for (const child of el.children) {
    visit(child);
    walk(child, visit);
  }
}

function allText(el: ParsedEl): string {
  let out = el.text;
  for (const child of el.children) out += ` ${allText(child)}`;
  return out;
}

function shouldStamp(el: ParsedEl): boolean {
  if (el.tag === "input" && (el.attrs.type ?? "text").toLowerCase() === "hidden") return false;
  if (INTERACTIVE_TAGS.has(el.tag) || HEADING_TAGS.has(el.tag)) return true;
  const role = el.attrs.role?.trim().toLowerCase();
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if ((el.attrs.contenteditable ?? "").toLowerCase() === "true") return true;
  return false;
}

function roleOf(el: ParsedEl): string {
  const explicit = el.attrs.role?.trim().toLowerCase();
  if (explicit) return explicit.slice(0, MAX_VC_ROLE);
  return implicitRole(el.tag, el.attrs.type).slice(0, MAX_VC_ROLE);
}

function shortPath(el: ParsedEl): string {
  const parts: string[] = [];
  let cursor: ParsedEl | null = el;
  while (cursor && cursor.tag !== "#root") {
    const parent: ParsedEl | null = cursor.parent;
    let seg = cursor.tag;
    if (parent) {
      const same = parent.children.filter((child: ParsedEl) => child.tag === cursor?.tag);
      if (same.length > 1) {
        seg += `:${same.indexOf(cursor)}`;
      }
    }
    parts.push(seg);
    cursor = parent;
  }
  return parts.reverse().slice(-3).join(">");
}

function nameOf(
  el: ParsedEl,
  byId: Map<string, ParsedEl>,
  labelsByFor: Map<string, ParsedEl>,
): string {
  const aria = collapseWs(el.attrs["aria-label"] ?? "");
  if (aria) return aria.slice(0, MAX_VC_NAME);
  const labelledBy = el.attrs["aria-labelledby"];
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => collapseWs(allText(byId.get(id) ?? emptyEl())))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" ").slice(0, MAX_VC_NAME);
  }
  if (el.tag === "img") {
    return collapseWs(el.attrs.alt ?? el.attrs.title ?? "").slice(0, MAX_VC_NAME);
  }
  if (el.tag === "input" || el.tag === "textarea" || el.tag === "select") {
    const type = (el.attrs.type ?? "text").toLowerCase();
    if (type === "submit" || type === "button" || type === "reset") {
      const value = collapseWs(el.attrs.value ?? "");
      if (value) return value.slice(0, MAX_VC_NAME);
    }
    if (type === "image") {
      return collapseWs(el.attrs.alt ?? "").slice(0, MAX_VC_NAME);
    }
    const forLabel = el.attrs.id ? labelsByFor.get(el.attrs.id) : undefined;
    if (forLabel) return collapseWs(allText(forLabel)).slice(0, MAX_VC_NAME);
    let parent: ParsedEl | null = el.parent;
    while (parent && parent.tag !== "#root") {
      if (parent.tag === "label") return collapseWs(allText(parent)).slice(0, MAX_VC_NAME);
      parent = parent.parent;
    }
    const placeholder = collapseWs(el.attrs.placeholder ?? "");
    if (placeholder) return placeholder.slice(0, MAX_VC_NAME);
    const title = collapseWs(el.attrs.title ?? "");
    if (title) return title.slice(0, MAX_VC_NAME);
    const name = collapseWs(el.attrs.name ?? "");
    if (name) return name.slice(0, MAX_VC_NAME);
  }
  return collapseWs(allText(el) || el.attrs.title || "").slice(0, MAX_VC_NAME);
}

function emptyEl(): ParsedEl {
  return {
    tag: "#empty",
    attrs: {},
    openStart: 0,
    openEnd: 0,
    selfClosing: true,
    parent: null,
    children: [],
    text: "",
  };
}

function collectIndexes(root: ParsedEl): {
  byId: Map<string, ParsedEl>;
  labelsByFor: Map<string, ParsedEl>;
} {
  const byId = new Map<string, ParsedEl>();
  const labelsByFor = new Map<string, ParsedEl>();
  walk(root, (el) => {
    if (el.attrs.id) byId.set(el.attrs.id, el);
    if (el.tag === "label" && el.attrs.for) labelsByFor.set(el.attrs.for, el);
  });
  return { byId, labelsByFor };
}

function assignIds(
  stampable: ParsedEl[],
  nameOfEl: (el: ParsedEl) => string,
): Map<ParsedEl, string> {
  const used = new Set<string>();
  const ids = new Map<ParsedEl, string>();
  for (const el of stampable) {
    const raw = el.attrs[VC_ID_ATTR]?.trim() ?? "";
    if (VC_ID_PATTERN.test(raw) && !used.has(raw)) {
      used.add(raw);
      ids.set(el, raw);
    }
  }
  for (const el of stampable) {
    if (ids.has(el)) continue;
    const role = roleOf(el);
    const name = nameOfEl(el);
    const path = shortPath(el);
    const slug = slugifyVcId(name);
    const hash = fnv1aHex(`${role}|${name}|${path}`);
    let candidate =
      slug && !used.has(slug) ? slug : slug ? `${slug}-${hash}`.slice(0, MAX_VC_ID) : `el-${hash}`;
    if (!VC_ID_PATTERN.test(candidate) || used.has(candidate)) {
      candidate = `el-${hash}`;
    }
    let n = 2;
    let id = candidate;
    while (used.has(id) || !VC_ID_PATTERN.test(id)) {
      id = `${candidate.slice(0, MAX_VC_ID - `-${n}`.length)}-${n}`;
      n += 1;
    }
    used.add(id);
    ids.set(el, id);
  }
  return ids;
}

function stampableList(root: ParsedEl): ParsedEl[] {
  const list: ParsedEl[] = [];
  walk(root, (el) => {
    if (shouldStamp(el)) list.push(el);
  });
  return list;
}

function toScreenNode(
  el: ParsedEl,
  ids: Map<ParsedEl, string>,
  stampable: Set<ParsedEl>,
  nameOfEl: (el: ParsedEl) => string,
): ScreenNode[] {
  const nodes: ScreenNode[] = [];
  for (const child of el.children) {
    if (stampable.has(child)) {
      const id = ids.get(child);
      if (!id) continue;
      nodes.push({
        el: id,
        role: roleOf(child),
        name: nameOfEl(child),
        tag: child.tag,
        children: toScreenNode(child, ids, stampable, nameOfEl),
      });
    } else {
      nodes.push(...toScreenNode(child, ids, stampable, nameOfEl));
    }
  }
  return nodes;
}

function analyze(html: string): {
  root: ParsedEl;
  stampable: ParsedEl[];
  ids: Map<ParsedEl, string>;
  nameOfEl: (el: ParsedEl) => string;
} {
  const root = parseDocument(html);
  const { byId, labelsByFor } = collectIndexes(root);
  const nameOfEl = (el: ParsedEl) => nameOf(el, byId, labelsByFor);
  const stampable = stampableList(root);
  const ids = assignIds(stampable, nameOfEl);
  return { root, stampable, ids, nameOfEl };
}

/** Accessibility tree of stampable elements, ids matching {@link stampVcIds}. */
export function screenTree(html: string): ScreenNode[] {
  const { root, stampable, ids, nameOfEl } = analyze(html);
  return toScreenNode(root, ids, new Set(stampable), nameOfEl);
}

export function flattenScreenTree(nodes: ScreenNode[]): ScreenNode[] {
  const out: ScreenNode[] = [];
  const walkNodes = (list: ScreenNode[]) => {
    for (const node of list) {
      out.push(node);
      walkNodes(node.children);
    }
  };
  walkNodes(nodes);
  return out;
}

export function findScreenElement(html: string, el: string): ScreenNode | undefined {
  return flattenScreenTree(screenTree(html)).find((node) => node.el === el);
}

interface Patch {
  start: number;
  end: number;
  text: string;
}

function openTagSlice(html: string, el: ParsedEl): string {
  return html.slice(el.openStart, el.openEnd);
}

function vcIdAttrRange(tag: string): { start: number; end: number } | null {
  const match = /\sdata-vc-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/i.exec(tag);
  if (!match || match.index === undefined) return null;
  return { start: match.index, end: match.index + match[0].length };
}

function insertBeforeClose(tag: string, attribute: string): { offset: number; text: string } {
  if (/\/>\s*$/.test(tag)) {
    return { offset: tag.length - 2, text: ` ${attribute}` };
  }
  return { offset: tag.length - 1, text: ` ${attribute}` };
}

/**
 * Insert or repair `data-vc-id` on interactive elements and headings.
 * Author-supplied valid unique ids are kept. Everything else is untouched.
 */
export function stampVcIds(html: string): string {
  const { stampable, ids } = analyze(html);
  const patches: Patch[] = [];
  for (const el of stampable) {
    const id = ids.get(el);
    if (!id) continue;
    const current = el.attrs[VC_ID_ATTR];
    if (current === id) continue;
    const tag = openTagSlice(html, el);
    const range = vcIdAttrRange(tag);
    if (range) {
      patches.push({
        start: el.openStart + range.start,
        end: el.openStart + range.end,
        text: ` ${VC_ID_ATTR}="${id}"`,
      });
    } else {
      const insert = insertBeforeClose(tag, `${VC_ID_ATTR}="${id}"`);
      patches.push({
        start: el.openStart + insert.offset,
        end: el.openStart + insert.offset,
        text: insert.text,
      });
    }
  }
  patches.sort((a, b) => b.start - a.start);
  let out = html;
  for (const patch of patches) {
    out = out.slice(0, patch.start) + patch.text + out.slice(patch.end);
  }
  return out;
}

export function isStampableHtmlPath(path: string): boolean {
  if (!/\.html?$/i.test(path)) return false;
  const base = path.split("/").pop() ?? "";
  return base !== "__canvas.html";
}

export function stampHtmlSource(path: string, text: string): string {
  if (!isStampableHtmlPath(path)) return text;
  return stampVcIds(text);
}

function isDomInteractive(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" && (el.getAttribute("type") ?? "text").toLowerCase() === "hidden") {
    return false;
  }
  if (INTERACTIVE_TAGS.has(tag) || HEADING_TAGS.has(tag)) return true;
  const role = el.getAttribute("role")?.trim().toLowerCase();
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if ((el.getAttribute("contenteditable") ?? "").toLowerCase() === "true") return true;
  return false;
}

function domRole(el: Element): string {
  const explicit = el.getAttribute("role")?.trim().toLowerCase();
  if (explicit) return explicit.slice(0, MAX_VC_ROLE);
  return implicitRole(el.tagName.toLowerCase(), el.getAttribute("type") ?? undefined).slice(
    0,
    MAX_VC_ROLE,
  );
}

function hasLabels(el: Element): el is Element & { labels: NodeListOf<HTMLLabelElement> | null } {
  return "labels" in el;
}

function domName(el: Element): string {
  const aria = collapseWs(el.getAttribute("aria-label") ?? "");
  if (aria) return aria.slice(0, MAX_VC_NAME);
  if (hasLabels(el)) {
    const fromLabel = el.labels?.[0] ? collapseWs(el.labels[0].textContent ?? "") : "";
    if (fromLabel) return fromLabel.slice(0, MAX_VC_NAME);
  }
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  const value = collapseWs(el.getAttribute("value") ?? "");
  if (value && (type === "submit" || type === "button" || type === "reset")) {
    return value.slice(0, MAX_VC_NAME);
  }
  const placeholder = collapseWs(el.getAttribute("placeholder") ?? "");
  if (placeholder) return placeholder.slice(0, MAX_VC_NAME);
  const alt = collapseWs(el.getAttribute("alt") ?? "");
  if (alt) return alt.slice(0, MAX_VC_NAME);
  return collapseWs(el.textContent ?? "").slice(0, MAX_VC_NAME);
}

/** Live-DOM counterpart of the HTML walker, for native-body clicks. */
export function describeDomElement(
  target: Element,
  stopAt?: Element | null,
): { el?: string; role?: string; name?: string } {
  let el: Element | null = target;
  while (el && el !== stopAt) {
    if (el.getAttribute(VC_ID_ATTR) || isDomInteractive(el)) {
      const id = el.getAttribute(VC_ID_ATTR)?.trim() ?? "";
      const role = domRole(el);
      const name = domName(el);
      return {
        ...(VC_ID_PATTERN.test(id) ? { el: id } : {}),
        ...(role ? { role } : {}),
        ...(name ? { name } : {}),
      };
    }
    el = el.parentElement;
  }
  return {};
}
