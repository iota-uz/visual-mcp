import "@visual-canvas/canvas/theme.css";
import {
  type CanvasDoc,
  type CanvasFile,
  CanvasFileSchema,
  formatElementRef,
  layoutCanvas,
  mountViewport,
  resolveCanvasPage,
  type ViewportController,
} from "@visual-canvas/canvas";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  GripVertical,
  History,
  Info,
  Lock,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
} from "lucide-react";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useSessionUser } from "../auth";
import { ConfirmButton } from "../components/ConfirmButton";
import { EmbedControl } from "../components/EmbedControl";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { RenameForm } from "../components/RenameForm";
import { toastError, useToast } from "../components/Toast";
import { Button, ButtonLink } from "../components/ui/Button";
import { CopyableValue, RefChip } from "../components/ui/CopyableValue";
import { Disclosure } from "../components/ui/Disclosure";
import { Drawer } from "../components/ui/Drawer";
import { IconButton, IconLink } from "../components/ui/IconButton";
import { resolveRequestedCanvasPage, withCanvasNodeSelection } from "../lib/canvasLocation";
import { formatBytes } from "../lib/formatBytes";
import { formatAbsoluteTime, formatRelativeTime } from "../lib/formatDate";
import { mcpBaseUrl } from "../lib/mcpUrl";
import {
  clampPrototypeHotspot,
  drawPrototypeHotspot,
  movePrototypeHotspot,
  type PrototypeHotspotRect,
  resizePrototypeHotspot,
} from "../lib/prototypeGeometry";
import { useDocumentTitle } from "../lib/useDocumentTitle";

// Mounts packages/canvas's framework-free viewport (pan/zoom/inspector/
// minimap/?node= deep-linking) directly against the fetched CanvasDoc —
// this is the client-side rendering path (PLAN.md Part 1 section 2/8),
// distinct from the worker's server-side render used for PNG/PDF export
// and for html/image/pdf-kind canvases (rendered via `entry_url` below).
export function CanvasViewport({
  doc,
  iframeBaseUrl,
  iframeRevisions,
  version,
  editable = false,
  onGeometryChange,
  onGroupMove,
  canvasRef,
  cameraStorageKey,
  immersive = false,
  syncSelectionToUrl = true,
}: {
  doc: CanvasDoc;
  iframeBaseUrl?: string | null;
  iframeRevisions?: Record<string, string> | null;
  version?: number;
  editable?: boolean;
  onGeometryChange?: (nodeId: string, rect: { x: number; y: number; w: number; h: number }) => void;
  onGroupMove?: (groupId: string, dx: number, dy: number) => void;
  canvasRef?: string;
  cameraStorageKey?: string;
  immersive?: boolean;
  syncSelectionToUrl?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ViewportController | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const setSearchParams = useSearchParams()[1];
  const { notify } = useToast();
  /*
   * Held in a ref, and deliberately out of the effect's dep array below.
   * react-router rebuilds `setSearchParams` whenever `location.search`
   * changes — which is exactly what `onSelect` does — so having it as a dep
   * meant every node click disposed the viewport, rebuilt the DOM and
   * re-ran fitAll(). Clicking a node, or clicking empty space to deselect,
   * threw away whatever the user had panned and zoomed to.
   */
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;
  const canvasRefRef = useRef(canvasRef);
  canvasRefRef.current = canvasRef;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const onGeometryChangeRef = useRef(onGeometryChange);
  onGeometryChangeRef.current = onGeometryChange;
  const onGroupMoveRef = useRef(onGroupMove);
  onGroupMoveRef.current = onGroupMove;
  const iframeRevisionsKey = JSON.stringify(iframeRevisions ?? null);
  const stableIframeRevisions = useMemo(
    () => JSON.parse(iframeRevisionsKey) as Record<string, string> | null,
    [iframeRevisionsKey],
  );
  const resolveIframeUrl = useCallback(
    (node: Extract<CanvasDoc["nodes"][number], { kind: "iframe" }>) => {
      const revision = stableIframeRevisions?.[node.source.entrypoint];
      return iframeBaseUrl
        ? `${iframeBaseUrl}${node.source.entrypoint}${revision ? `?vcv=${encodeURIComponent(revision)}` : ""}${node.source.route ?? ""}`
        : `${node.source.entrypoint}${node.source.route ?? ""}`;
    },
    [iframeBaseUrl, stableIframeRevisions],
  );
  const resolveIframeIdentity = useCallback(
    (node: Extract<CanvasDoc["nodes"][number], { kind: "iframe" }>) =>
      JSON.stringify({
        entrypoint: node.source.entrypoint,
        route: node.source.route ?? "",
        revision: stableIframeRevisions?.[node.source.entrypoint] ?? "",
      }),
    [stableIframeRevisions],
  );
  const resolveImageUrl = useCallback(
    (node: Extract<CanvasDoc["nodes"][number], { kind: "image" }>) =>
      iframeBaseUrl
        ? `${iframeBaseUrl}${node.source.path}${version === undefined ? "" : `?vcv=${version}`}`
        : node.source.path,
    [iframeBaseUrl, version],
  );
  const resolveIframeIdentityRef = useRef(resolveIframeIdentity);
  resolveIframeIdentityRef.current = resolveIframeIdentity;
  const resolveIframeUrlRef = useRef(resolveIframeUrl);
  resolveIframeUrlRef.current = resolveIframeUrl;
  const resolveImageUrlRef = useRef(resolveImageUrl);
  resolveImageUrlRef.current = resolveImageUrl;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let positioned: ReturnType<typeof layoutCanvas>;
    try {
      positioned = layoutCanvas(docRef.current);
    } catch (err) {
      container.textContent = `Layout error: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    let initialView: { x: number; y: number; scale: number } | undefined;
    if (cameraStorageKey) {
      try {
        const stored = window.localStorage.getItem(cameraStorageKey);
        if (stored) {
          const parsed = JSON.parse(stored) as { x?: unknown; y?: unknown; scale?: unknown };
          if (
            typeof parsed.x === "number" &&
            typeof parsed.y === "number" &&
            typeof parsed.scale === "number"
          ) {
            initialView = { x: parsed.x, y: parsed.y, scale: parsed.scale };
          }
        }
      } catch {
        // A corrupt personal camera preference should fall back to deterministic Fit.
      }
    }

    const controller = mountViewport({
      container,
      canvas: positioned,
      initialView,
      fitOnResize: immersive,
      onViewChange: cameraStorageKey
        ? (view) => {
            try {
              window.localStorage.setItem(cameraStorageKey, JSON.stringify(view));
            } catch {
              // Storage can be unavailable in privacy modes; camera behavior remains functional.
            }
          }
        : undefined,
      editable,
      resolveIframeUrl: (node) =>
        resolveIframeUrlRef.current?.(node) ??
        `${node.source.entrypoint}${node.source.route ?? ""}`,
      resolveImageUrl: (node) => resolveImageUrlRef.current(node),
      resolveIframeIdentity: (node) => resolveIframeIdentityRef.current(node),
      onSelect: (nodeId) => {
        if (!syncSelectionToUrl) return;
        /*
         * `replace`, not push. Selection is view state, not navigation: the
         * URL exists so a selected node can be linked and reloaded, and the
         * viewport has no listener for the reverse direction, so a pushed
         * entry would rewind the URL while leaving the node visibly
         * selected — and 15 node clicks would cost 15 Backs to leave the
         * page. Escape (handled inside the viewport) is the deselect.
         */
        setSearchParamsRef.current(withCanvasNodeSelection(window.location.search, nodeId), {
          replace: true,
        });
      },
      onGeometryChange: (nodeId, rect) => onGeometryChangeRef.current?.(nodeId, rect),
      onGroupMove: (groupId, dx, dy) => onGroupMoveRef.current?.(groupId, dx, dy),
      resolveElementRef: (nodeId) => {
        const currentCanvasRef = canvasRefRef.current;
        return currentCanvasRef ? formatElementRef(currentCanvasRef, nodeId) : undefined;
      },
      onCopyElementRef: async (refId) => {
        try {
          await navigator.clipboard.writeText(refId);
          notifyRef.current({ message: "Element ref copied." });
        } catch (err: unknown) {
          notifyRef.current(toastError(err, "Couldn't copy element ref"));
        }
      },
    });
    controllerRef.current = controller;
    if (immersive) {
      const iframeNode = docRef.current.nodes.find((node) => node.kind === "iframe");
      if (iframeNode) controller.activateIframe(iframeNode.id);
    }

    // Read the deep-linked node directly from the URL rather than the
    // reactive `useSearchParams` value on purpose — this effect should only
    // re-run when `doc` changes, not on every node selection (which also
    // updates the URL's search params via setSearchParams above).
    const initialNode = syncSelectionToUrl
      ? new URLSearchParams(window.location.search).get("node")
      : null;
    if (initialNode) controller.selectNode(initialNode, true);

    return () => {
      controllerRef.current = null;
      controller.dispose();
    };
  }, [cameraStorageKey, editable, immersive, syncSelectionToUrl]);

  useEffect(() => {
    try {
      controllerRef.current?.updateCanvas(layoutCanvas(doc), {
        resolveIframeUrl,
        resolveImageUrl,
        resolveIframeIdentity,
      });
    } catch {
      // Keep the last valid reactive document visible if a new one cannot lay out.
    }
  }, [doc, resolveIframeIdentity, resolveIframeUrl, resolveImageUrl]);

  return (
    <div ref={containerRef} className={`vc-viewport-host${immersive ? " vc-immersive" : ""}`} />
  );
}

interface CanvasVersion {
  versionId: string;
  version: number;
  note?: string;
  createdAt: number;
  createdByEmail: string | null;
  isCurrent: boolean;
}

/*
 * One eyebrow-labelled section of the details drawer. The drawer used to be
 * six unrelated things in a single unstructured column, with the share link
 * — the entire point of publishing — fourth from the bottom, under a caveat
 * about iframes.
 */
function DrawerSection({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="drawer-section">
      <header className="drawer-section-head">
        <h3>{label}</h3>
        {aside && <span className="drawer-section-aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

function PublishControl({
  canvasId,
  visibility,
  publicSlug,
  title,
  version,
  doc,
  artifacts,
}: {
  canvasId: Id<"canvases">;
  visibility: "private" | "public";
  publicSlug: string | undefined;
  title: string;
  version: number | undefined;
  doc: CanvasDoc | null;
  artifacts: Array<{
    path: string;
    type: "pdf" | "image" | "svg" | "source";
    role: "primary" | "supporting";
  }>;
}) {
  const publish = useMutation(api.canvases.publishMine);
  const rotateSlug = useMutation(api.canvases.rotateMySlug);
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const shareUrl = publicSlug ? `${window.location.origin}/s/${publicSlug}` : null;

  async function publishNow() {
    setBusy(true);
    try {
      await publish({ canvasId, visibility: "public" });
      notify({ message: "Published." });
    } catch (err: unknown) {
      notify(toastError(err, "Couldn't publish"));
    } finally {
      setBusy(false);
    }
  }

  // Unpublishing and replacing the link both kill every link already in
  // circulation, instantly and with no way back — so both arm first, same
  // as a delete.
  async function unpublish() {
    await publish({ canvasId, visibility: "private" });
    notify({ message: "Made private. The old share link no longer resolves." });
  }

  async function replaceLink() {
    await rotateSlug({ canvasId });
    notify({ message: "Replaced the link. The old one is dead." });
  }

  return (
    <DrawerSection label="Share">
      {visibility === "public" && shareUrl ? (
        <>
          <div className="share-status-row">
            <span className="share-status share-status-public">Public</span>
            <p className="drawer-section-note">Anyone with the link can open it.</p>
          </div>
          {/* The whole point of publishing is handing someone a URL. This
              used to be dead muted text printing a *relative* path, so the
              one thing a human came here for had to be retyped by hand. */}
          <CopyableValue
            className="share-link-row"
            as="link"
            value={shareUrl}
            copyLabel="Copy link"
          />
          <Disclosure summary="Manage link" className="share-disclosure">
            <p className="drawer-section-note">
              These actions immediately revoke links already in circulation.
            </p>
            <div className="publish-control">
              <ConfirmButton
                label="Make private"
                confirmLabel="Really make private?"
                busyLabel="Updating…"
                tone="warning"
                icon={Lock}
                description="Every link you have shared stops working."
                onConfirm={unpublish}
              />
              <ConfirmButton
                label="Replace link"
                confirmLabel="Really replace?"
                busyLabel="Replacing…"
                tone="warning"
                icon={RefreshCw}
                description="Mints a new link and permanently breaks the current one."
                onConfirm={replaceLink}
              />
            </div>
          </Disclosure>
          <Disclosure summary="Embed in Markdown" className="share-disclosure embed-disclosure">
            <EmbedControl
              title={title}
              publicSlug={publicSlug as string}
              version={version}
              doc={doc}
              artifacts={artifacts}
            />
          </Disclosure>
        </>
      ) : (
        <>
          <div className="share-status-row">
            <span className="share-status">Private</span>
            <p className="drawer-section-note">Only signed-in @iota.uz accounts can open it.</p>
          </div>
          <div className="publish-control">
            <Button variant="primary" onClick={publishNow} busy={busy}>
              {busy ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </>
      )}
    </DrawerSection>
  );
}

function RestoreButton({ canvasId, version }: { canvasId: Id<"canvases">; version: number }) {
  const restore = useMutation(api.canvases.restoreVersionMine);
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore() {
    setBusy(true);
    setError(null);
    try {
      await restore({ canvasId, version });
      notify({ message: `Restored v${version} into a new checkpoint.` });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" icon={History} onClick={handleRestore} busy={busy}>
        {busy ? "Restoring…" : "Restore"}
      </Button>
      {error && <span className="error-text">{error}</span>}
    </>
  );
}

// The rows used to be inert text: the backend has kept every version since
// v1, but a human could see them and not act on them. Restoring is
// non-destructive — restore copies an immutable checkpoint into the draft and
// records a new restore-derived checkpoint, preserving monotonic history.
export function VersionHistory({
  canvasId,
  versions,
  dirty,
}: {
  canvasId: Id<"canvases">;
  versions: CanvasVersion[] | undefined;
  dirty: boolean;
}) {
  if (versions === undefined) return <LoadingState label="Loading version history…" />;
  if (versions.length === 0) return null;

  return (
    <DrawerSection label="Versions" aside={`${versions.length} kept`}>
      <ul className="card-list version-list">
        {versions.map((v) => (
          <li key={v.versionId} className="card-list-item">
            <div className="version-row-main">
              <strong>
                v{v.version}
                {v.isCurrent && <span className="version-row-current">current</span>}
              </strong>
              {v.note && <span className="muted"> — {v.note}</span>}
              <span className="muted version-row-meta">
                <time
                  dateTime={new Date(v.createdAt).toISOString()}
                  title={formatAbsoluteTime(v.createdAt)}
                >
                  {formatRelativeTime(v.createdAt)}
                </time>
                {v.createdByEmail && ` · ${v.createdByEmail}`}
              </span>
            </div>
            {(!v.isCurrent || dirty) && (
              <div className="row-item-actions">
                <RestoreButton canvasId={canvasId} version={v.version} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </DrawerSection>
  );
}

interface FetchableCanvas {
  kind: string;
  doc_url: string | null;
  css_url: string | null;
  iframe_revisions?: Record<string, string> | null;
  version?: number;
}

// Shared by CanvasPage (signed-in) and PublicCanvasPage (anonymous
// /s/:slug) — both resolve a canvas summary first, then need this same
// doc-fetch-and-validate plus compiled-Tailwind-CSS-injection sequence.
export function useCanvasDocAndCss(
  canvas: FetchableCanvas | null | undefined,
  pageId?: string | null,
) {
  const [file, setFile] = useState<CanvasFile | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  // Keyed on the two fields the fetch actually depends on, not the whole
  // `canvas` object: Convex hands back a fresh object on *any* field change,
  // so renaming or publishing used to blank the doc, flash "Loading canvas…"
  // full-screen, refetch, and remount the viewport — losing your pan/zoom.
  const kind = canvas?.kind;
  const docUrl = canvas?.doc_url ?? null;

  useEffect(() => {
    setDocError(null);
    if (kind !== "canvas" || !docUrl) {
      setFile(null);
      return;
    }
    let cancelled = false;
    fetch(docUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Unable to load canvas document (${res.status})`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        try {
          setFile(CanvasFileSchema.parse(json));
        } catch (error) {
          setDocError(
            `Stored document failed validation: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setDocError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [kind, docUrl]);

  // Compiled Tailwind CSS for the doc's HTML nodes (PLAN.md section 2) —
  // injected as a page-level <style> tag before the viewport mounts, so
  // Tailwind-classed node mockups aren't unstyled on first paint. `cssReady`
  // starts false so mounting waits for either the fetch to land or for
  // there being nothing to fetch, rather than racing it.
  const [cssReady, setCssReady] = useState(false);
  const activeCssRef = useRef<HTMLStyleElement | null>(null);
  useEffect(() => {
    // Keep the previous stylesheet active while a reactive replacement is
    // fetched. A transient loading state here used to unmount the complete
    // viewport on every version and looked exactly like a page refresh.
    if (!canvas?.css_url) {
      activeCssRef.current?.remove();
      activeCssRef.current = null;
      setCssReady(true);
      return;
    }
    let cancelled = false;
    fetch(canvas.css_url)
      .then((res) => {
        if (!res.ok) throw new Error(`Unable to load canvas styles (${res.status})`);
        return res.text();
      })
      .then((css) => {
        if (cancelled) return;
        const styleEl = document.createElement("style");
        styleEl.setAttribute("data-vc-node-css", "");
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
        activeCssRef.current?.remove();
        activeCssRef.current = styleEl;
        setCssReady(true);
      })
      .catch(() => {
        if (!cancelled) setCssReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [canvas?.css_url]);

  useEffect(
    () => () => {
      activeCssRef.current?.remove();
      activeCssRef.current = null;
    },
    [],
  );

  const page = file ? resolveRequestedCanvasPage(file, pageId) : null;
  const pageError =
    file && pageId && !page
      ? `Page "${pageId}" no longer exists. Select another Page, or recover it from Details → Versions.`
      : null;
  return { file, page, doc: page?.doc ?? null, docError: docError ?? pageError, cssReady };
}

function nextPageId(file: CanvasFile, title: string) {
  const base =
    title
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "page";
  let id = base;
  let suffix = 2;
  while (file.pages.some((page) => page.id === id)) id = `${base}-${suffix++}`;
  return id;
}

export function PagesPanel({
  file,
  activePageId,
  collapsed,
  onCollapsedChange,
  onSelect,
  onSave,
}: {
  file: CanvasFile;
  activePageId: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onSelect: (pageId: string) => void;
  onSave: (file: CanvasFile, note: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    pageId: string;
    position: "before" | "after";
  } | null>(null);
  const [menuPageId, setMenuPageId] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const { notify } = useToast();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const draggingIdRef = useRef<string | null>(null);
  const dropTargetRef = useRef<{ pageId: string; position: "before" | "after" } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const ordered = [...file.pages].sort((a, b) => a.order - b.order);
  useEffect(() => {
    if (creating || editingId) nameInputRef.current?.focus();
  }, [creating, editingId]);

  useEffect(() => {
    if (!menuPageId) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(`[data-page-menu="${menuPageId}"]`)) return;
      setMenuPageId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuPageId(null);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuPageId]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  async function createPage() {
    const title = value.trim();
    if (!title) return;
    const id = nextPageId(file, title);
    const template = resolveCanvasPage(file).doc;
    const doc = {
      ...template,
      title,
      subtitle: undefined,
      lanes: [],
      stages: [],
      labels: [],
      nodes: [],
      groups: [],
      edges: [],
      legend: undefined,
    };
    await onSave(
      CanvasFileSchema.parse({
        ...file,
        pages: [...file.pages, { id, title, order: file.pages.length, doc }],
      }),
      `Create Page: ${title}`,
    );
    setCreating(false);
    setValue("");
    onSelect(id);
  }

  async function renamePage(pageId: string) {
    const title = value.trim();
    if (!title) return;
    const current = file.pages.find((page) => page.id === pageId);
    if (current?.title === title) {
      setEditingId(null);
      setValue("");
      return;
    }
    await onSave(
      CanvasFileSchema.parse({
        ...file,
        pages: file.pages.map((page) => (page.id === pageId ? { ...page, title } : page)),
      }),
      `Rename Page: ${title}`,
    );
    setEditingId(null);
    setValue("");
  }

  async function movePage(pageId: string, delta: number) {
    const pages = [...ordered];
    const from = pages.findIndex((page) => page.id === pageId);
    const to = Math.max(0, Math.min(pages.length - 1, from + delta));
    if (from === to) return;
    const [page] = pages.splice(from, 1);
    if (!page) return;
    pages.splice(to, 0, page);
    await onSave(
      CanvasFileSchema.parse({
        ...file,
        pages: pages.map((candidate, order) => ({ ...candidate, order })),
      }),
      `Move Page: ${pageId}`,
    );
  }

  async function dropPage(pageId: string, targetPageId: string, position: "before" | "after") {
    if (pageId === targetPageId) return;
    const pages = [...ordered];
    const from = pages.findIndex((page) => page.id === pageId);
    const [page] = pages.splice(from, 1);
    if (!page) return;
    const targetIndex = pages.findIndex((candidate) => candidate.id === targetPageId);
    if (targetIndex < 0) return;
    pages.splice(targetIndex + (position === "after" ? 1 : 0), 0, page);
    await onSave(
      CanvasFileSchema.parse({
        ...file,
        pages: pages.map((candidate, order) => ({ ...candidate, order })),
      }),
      `Move Page: ${pageId}`,
    );
  }

  function dropTargetAtPoint(clientX: number, clientY: number) {
    const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-page-id]");
    const pageId = row?.dataset.pageId;
    if (!row || !pageId || pageId === draggingIdRef.current) return null;
    const bounds = row.getBoundingClientRect();
    return {
      pageId,
      position: clientY < bounds.top + bounds.height / 2 ? ("before" as const) : ("after" as const),
    };
  }

  function updateDropTarget(target: { pageId: string; position: "before" | "after" } | null) {
    dropTargetRef.current = target;
    setDropTarget(target);
  }

  function finishDragging() {
    draggingIdRef.current = null;
    dropTargetRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  }

  function beginDragging(event: ReactPointerEvent<HTMLButtonElement>, pageId: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragCleanupRef.current?.();
    draggingIdRef.current = pageId;
    setDraggingId(pageId);
    setMenuPageId(null);

    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", drop);
      document.removeEventListener("pointercancel", cancel);
      dragCleanupRef.current = null;
    };
    const move = (moveEvent: PointerEvent) => {
      updateDropTarget(dropTargetAtPoint(moveEvent.clientX, moveEvent.clientY));
    };
    const drop = (upEvent: PointerEvent) => {
      const target = dropTargetAtPoint(upEvent.clientX, upEvent.clientY) ?? dropTargetRef.current;
      cleanup();
      finishDragging();
      if (target) void dropPage(pageId, target.pageId, target.position);
    };
    const cancel = () => {
      cleanup();
      finishDragging();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", drop);
    document.addEventListener("pointercancel", cancel);
    dragCleanupRef.current = cleanup;
  }

  async function duplicatePage(pageId: string) {
    const source = file.pages.find((page) => page.id === pageId);
    if (!source) return;
    const title = `${source.title} copy`;
    const id = nextPageId(file, title);
    await onSave(
      CanvasFileSchema.parse({
        ...file,
        pages: [...file.pages, { ...structuredClone(source), id, title, order: file.pages.length }],
      }),
      `Duplicate Page: ${source.title}`,
    );
    onSelect(id);
  }

  async function deletePage(pageId: string) {
    if (file.pages.length === 1) return;
    const pages = ordered
      .filter((page) => page.id !== pageId)
      .map((page, order) => ({ ...page, order }));
    const fallbackPage = pages[0];
    if (!fallbackPage) return;
    const next = CanvasFileSchema.parse({
      ...file,
      defaultPageId: file.defaultPageId === pageId ? fallbackPage.id : file.defaultPageId,
      pages,
      prototype: {
        start: file.prototype.start?.pageId === pageId ? undefined : file.prototype.start,
        interactions: file.prototype.interactions.filter(
          (interaction) =>
            interaction.source.pageId !== pageId && interaction.destination.pageId !== pageId,
        ),
      },
    });
    await onSave(next, `Delete Page: ${pageId}`);
    const deleted = file.pages.find((page) => page.id === pageId);
    setPendingDeleteId(null);
    if (activePageId === pageId) onSelect(next.defaultPageId);
    notify({
      message: `Deleted Page "${deleted?.title ?? pageId}". To recover it, open Details → Versions and restore a checkpoint.`,
      durationMs: 10_000,
    });
  }

  return (
    <aside className={`canvas-pages-panel${collapsed ? " is-collapsed" : ""}`} aria-label="Pages">
      <div className="canvas-pages-head">
        {!collapsed && <strong>Pages</strong>}
        <IconButton
          icon={collapsed ? PanelLeftOpen : PanelLeftClose}
          label={collapsed ? "Expand Pages" : "Collapse Pages"}
          iconSize={16}
          onClick={() => onCollapsedChange(!collapsed)}
        />
      </div>
      {collapsed ? (
        <IconButton
          icon={Plus}
          label="Create Page"
          iconSize={17}
          onClick={() => onCollapsedChange(false)}
        />
      ) : (
        <>
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setCreating(true)}>
            Create Page
          </Button>
          {creating && (
            <input
              ref={nameInputRef}
              className="canvas-page-name-input"
              aria-label="New Page name"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onBlur={() => void createPage()}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createPage();
                if (event.key === "Escape") setCreating(false);
              }}
            />
          )}
          <ol className="canvas-pages-list">
            {ordered.map((page) => (
              <li
                key={page.id}
                data-page-id={page.id}
                className={[
                  page.id === activePageId ? "is-active" : "",
                  page.id === draggingId ? "is-dragging" : "",
                  dropTarget?.pageId === page.id ? `is-drop-${dropTarget.position}` : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <IconButton
                  icon={GripVertical}
                  label={`Drag to reorder ${page.title}`}
                  iconSize={15}
                  className="canvas-page-drag-handle"
                  onPointerDown={(event) => beginDragging(event, page.id)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      void movePage(page.id, -1);
                    }
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      void movePage(page.id, 1);
                    }
                  }}
                />
                {editingId === page.id ? (
                  <input
                    ref={nameInputRef}
                    className="canvas-page-name-input"
                    aria-label={`Rename ${page.title}`}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    onBlur={() => void renamePage(page.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void renamePage(page.id);
                      if (event.key === "Escape") {
                        setValue(page.title);
                        setEditingId(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="canvas-page-select"
                    onClick={() => onSelect(page.id)}
                    onDoubleClick={() => {
                      setEditingId(page.id);
                      setValue(page.title);
                    }}
                  >
                    <span>{page.title}</span>
                    {page.id === file.defaultPageId && <small>default</small>}
                  </button>
                )}
                {pendingDeleteId === page.id ? (
                  <fieldset
                    className="canvas-page-delete-confirm"
                    aria-label={`Confirm deletion of ${page.title}`}
                  >
                    <span>Delete “{page.title}”?</span>
                    <Button size="sm" variant="danger" onClick={() => void deletePage(page.id)}>
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPendingDeleteId(null)}>
                      Cancel
                    </Button>
                  </fieldset>
                ) : editingId !== page.id ? (
                  <div className="canvas-page-actions">
                    <IconButton
                      icon={MoreHorizontal}
                      label={`More actions for ${page.title}`}
                      iconSize={15}
                      aria-expanded={menuPageId === page.id}
                      aria-haspopup="menu"
                      onClick={() => setMenuPageId(menuPageId === page.id ? null : page.id)}
                    />
                    {menuPageId === page.id && (
                      <div className="canvas-page-menu" role="menu" data-page-menu={page.id}>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuPageId(null);
                            void duplicatePage(page.id);
                          }}
                        >
                          <Copy size={14} aria-hidden="true" />
                          Duplicate
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="is-danger"
                          disabled={ordered.length === 1}
                          onClick={() => {
                            setMenuPageId(null);
                            setPendingDeleteId(page.id);
                          }}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          Delete Page…
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

function PrototypeHotspotEditor({
  frameTitle,
  viewport,
  value,
  onChange,
}: {
  frameTitle: string;
  viewport: { width: number; height: number };
  value: PrototypeHotspotRect;
  onChange: (hotspot: PrototypeHotspotRect) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<
    | { mode: "draw"; start: { x: number; y: number } }
    | { mode: "move"; offset: { x: number; y: number } }
    | { mode: "resize"; start: { x: number; y: number }; hotspot: PrototypeHotspotRect }
    | null
  >(null);
  const landscape = viewport.width >= viewport.height;

  function arrowDelta(key: string, step: number): [number, number] | undefined {
    if (key === "ArrowLeft") return [-step, 0];
    if (key === "ArrowRight") return [step, 0];
    if (key === "ArrowUp") return [0, -step];
    if (key === "ArrowDown") return [0, step];
    return undefined;
  }

  function point(event: ReactPointerEvent) {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: Math.round(((event.clientX - bounds.left) / bounds.width) * viewport.width),
      y: Math.round(((event.clientY - bounds.top) / bounds.height) * viewport.height),
    };
  }

  function handlePointerMove(event: ReactPointerEvent) {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const current = point(event);
    if (gesture.mode === "draw") {
      onChange(drawPrototypeHotspot(gesture.start, current, viewport));
    } else if (gesture.mode === "move") {
      onChange(
        movePrototypeHotspot(
          value,
          current.x - gesture.offset.x,
          current.y - gesture.offset.y,
          viewport,
        ),
      );
    } else {
      onChange(
        resizePrototypeHotspot(
          gesture.hotspot,
          gesture.hotspot.width + current.x - gesture.start.x,
          gesture.hotspot.height + current.y - gesture.start.y,
          viewport,
        ),
      );
    }
  }

  function endGesture() {
    gestureRef.current = null;
  }

  const hotspotStyle = {
    left: `${(value.x / viewport.width) * 100}%`,
    top: `${(value.y / viewport.height) * 100}%`,
    width: `${(value.width / viewport.width) * 100}%`,
    height: `${(value.height / viewport.height) * 100}%`,
  };
  const nudge = (dx: number, dy: number) =>
    onChange(movePrototypeHotspot(value, value.x + dx, value.y + dy, viewport));

  return (
    <div className="canvas-prototype-editor-group">
      <span>Draw hotspot on {frameTitle}</span>
      <div className="canvas-prototype-editor-shell">
        <section
          ref={surfaceRef}
          className="canvas-prototype-editor-surface"
          style={
            landscape
              ? { width: "100%", aspectRatio: `${viewport.width} / ${viewport.height}` }
              : { height: 220, aspectRatio: `${viewport.width} / ${viewport.height}` }
          }
          aria-label={`Hotspot drawing surface for ${frameTitle}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const start = point(event);
            gestureRef.current = { mode: "draw", start };
            event.currentTarget.setPointerCapture(event.pointerId);
            onChange(drawPrototypeHotspot(start, start, viewport));
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
        >
          <button
            type="button"
            className="canvas-prototype-hotspot"
            style={hotspotStyle}
            aria-label="Prototype hotspot. Drag to move; use arrow keys for precise positioning."
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              const current = point(event);
              gestureRef.current = {
                mode: "move",
                offset: { x: current.x - value.x, y: current.y - value.y },
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 10 : 1;
              const movement = arrowDelta(event.key, step);
              if (!movement) return;
              event.preventDefault();
              nudge(movement[0], movement[1]);
            }}
          />
          <button
            type="button"
            className="canvas-prototype-hotspot-resize"
            style={{
              left: `${((value.x + value.width) / viewport.width) * 100}%`,
              top: `${((value.y + value.height) / viewport.height) * 100}%`,
            }}
            aria-label="Resize prototype hotspot"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              gestureRef.current = { mode: "resize", start: point(event), hotspot: value };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 10 : 1;
              const delta = arrowDelta(event.key, step);
              if (!delta) return;
              event.preventDefault();
              onChange(
                resizePrototypeHotspot(
                  value,
                  value.width + delta[0],
                  value.height + delta[1],
                  viewport,
                ),
              );
            }}
          />
        </section>
      </div>
      <small>Drag on the frame to draw. Drag the blue area to move and its corner to resize.</small>
    </div>
  );
}

function PrototypePanel({
  file,
  activePageId,
  onSave,
}: {
  file: CanvasFile;
  activePageId: string;
  onSave: (file: CanvasFile, note: string) => Promise<void>;
}) {
  const sourcePage = resolveCanvasPage(file, activePageId);
  const [sourceNodeId, setSourceNodeId] = useState(sourcePage.doc.nodes[0]?.id ?? "");
  const [destinationPageId, setDestinationPageId] = useState(file.defaultPageId);
  const destinationPage = resolveCanvasPage(file, destinationPageId);
  const [destinationNodeId, setDestinationNodeId] = useState(
    destinationPage.doc.nodes[0]?.id ?? "",
  );
  const [transition, setTransition] = useState<
    "instant" | "dissolve" | "slide-left" | "slide-right"
  >("instant");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hotspot, setHotspot] = useState({ x: 0, y: 0, width: 120, height: 48 });
  const sourceNode = sourcePage.doc.nodes.find((node) => node.id === sourceNodeId);
  const sourceViewport = sourceNode
    ? sourceNode.kind === "iframe"
      ? sourceNode.viewport
      : { width: sourceNode.rect.w, height: sourceNode.rect.h }
    : null;
  const sourceViewportWidth = sourceViewport?.width;
  const sourceViewportHeight = sourceViewport?.height;

  useEffect(() => {
    setSourceNodeId(sourcePage.doc.nodes[0]?.id ?? "");
  }, [sourcePage.doc.nodes]);
  useEffect(() => {
    setDestinationNodeId(destinationPage.doc.nodes[0]?.id ?? "");
  }, [destinationPage.doc.nodes]);
  useEffect(() => {
    if (sourceViewportWidth === undefined || sourceViewportHeight === undefined) return;
    setHotspot((current) =>
      clampPrototypeHotspot(current, {
        width: sourceViewportWidth,
        height: sourceViewportHeight,
      }),
    );
  }, [sourceViewportHeight, sourceViewportWidth]);

  async function setStart() {
    if (!sourceNodeId) return;
    await onSave(
      CanvasFileSchema.parse({
        ...file,
        prototype: {
          ...file.prototype,
          start: { pageId: activePageId, nodeId: sourceNodeId },
        },
      }),
      "Set prototype start",
    );
  }

  async function saveInteraction() {
    if (!sourceNodeId || !destinationNodeId) return;
    const id = editingId ?? `${activePageId}-${sourceNodeId}-${Date.now().toString(36)}`;
    const interaction = {
      id,
      source: { pageId: activePageId, nodeId: sourceNodeId },
      hotspot,
      trigger: "tap" as const,
      destination: { pageId: destinationPageId, nodeId: destinationNodeId },
      transition,
    };
    const interactions = file.prototype.interactions.filter((item) => item.id !== id);
    await onSave(
      CanvasFileSchema.parse({
        ...file,
        prototype: { ...file.prototype, interactions: [...interactions, interaction] },
      }),
      editingId ? "Edit prototype hotspot" : "Create prototype hotspot",
    );
    setEditingId(null);
  }

  async function removeInteraction(id: string) {
    await onSave(
      CanvasFileSchema.parse({
        ...file,
        prototype: {
          ...file.prototype,
          interactions: file.prototype.interactions.filter((item) => item.id !== id),
        },
      }),
      "Delete prototype hotspot",
    );
  }

  return (
    <aside className="canvas-prototype-panel" aria-label="Prototype">
      <header>
        <strong>Prototype</strong>
      </header>
      <label>
        Source frame
        <select value={sourceNodeId} onChange={(event) => setSourceNodeId(event.target.value)}>
          {sourcePage.doc.nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.caption.title}
            </option>
          ))}
        </select>
      </label>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void setStart()}
        disabled={!sourceNodeId}
      >
        Set as start frame
      </Button>
      <hr />
      {sourceNode && sourceViewport && (
        <PrototypeHotspotEditor
          frameTitle={sourceNode.caption.title}
          viewport={sourceViewport}
          value={hotspot}
          onChange={setHotspot}
        />
      )}
      <label>
        Destination Page
        <select
          value={destinationPageId}
          onChange={(event) => setDestinationPageId(event.target.value)}
        >
          {file.pages.map((page) => (
            <option key={page.id} value={page.id}>
              {page.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Destination frame
        <select
          value={destinationNodeId}
          onChange={(event) => setDestinationNodeId(event.target.value)}
        >
          {destinationPage.doc.nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.caption.title}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Hotspot</legend>
        {(["x", "y", "width", "height"] as const).map((field) => (
          <label key={field}>
            {field}
            <input
              type="number"
              min="0"
              value={hotspot[field]}
              onChange={(event) =>
                setHotspot((current) => ({ ...current, [field]: Number(event.target.value) }))
              }
            />
          </label>
        ))}
      </fieldset>
      <label>
        Transition
        <select
          value={transition}
          onChange={(event) => setTransition(event.target.value as typeof transition)}
        >
          <option value="instant">Instant</option>
          <option value="dissolve">Dissolve</option>
          <option value="slide-left">Slide left</option>
          <option value="slide-right">Slide right</option>
        </select>
      </label>
      <Button
        size="sm"
        variant="primary"
        onClick={() => void saveInteraction()}
        disabled={!sourceNodeId || !destinationNodeId}
      >
        {editingId ? "Update hotspot" : "Create hotspot"}
      </Button>
      <ul className="canvas-prototype-list">
        {file.prototype.interactions.map((interaction) => (
          <li key={interaction.id}>
            <span>
              {interaction.source.nodeId} → {interaction.destination.nodeId}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditingId(interaction.id);
                setSourceNodeId(interaction.source.nodeId);
                setDestinationPageId(interaction.destination.pageId);
                setDestinationNodeId(interaction.destination.nodeId);
                setHotspot(interaction.hotspot);
                setTransition(interaction.transition);
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void removeInteraction(interaction.id)}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function CanvasPage() {
  const { canvasId } = useParams<{ canvasId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionUser = useSessionUser();
  const requestedPageId = searchParams.get("page");
  const canvas = useQuery(
    api.canvases.getMine,
    canvasId ? { canvasId: canvasId as Id<"canvases"> } : "skip",
  );
  const mintIframeCapability = useMutation(api.canvases.mintIframeCapabilityMine);
  const patchGeometry = useAction(api.canvases.patchGeometryMine);
  const saveCanvasFile = useAction(api.canvases.saveCanvasFileMine);
  const checkpoint = useMutation(api.canvases.checkpointMine);
  const [iframeCapability, setIframeCapability] = useState<{
    token: string;
    expiresAt: number;
    revisions: Record<string, string> | null;
  } | null>(null);
  const canvasVersion = canvas?.version;
  const iframeRevisions = canvas?.iframe_revisions ?? null;
  const iframeRevisionsKey = JSON.stringify(iframeRevisions);
  useEffect(() => {
    if (!canvasId || canvas?.kind !== "canvas") {
      setIframeCapability(null);
      return;
    }
    let cancelled = false;
    let renewalTimer: number | null = null;
    const revisionsSnapshot = JSON.parse(iframeRevisionsKey) as Record<string, string> | null;
    async function refreshCapability() {
      try {
        const { token, expiresAt } = await mintIframeCapability({
          canvasId: canvasId as Id<"canvases">,
        });
        if (cancelled) return;
        setIframeCapability({
          token,
          expiresAt,
          revisions: revisionsSnapshot,
        });
        renewalTimer = window.setTimeout(
          () => void refreshCapability(),
          Math.max(1_000, expiresAt - Date.now() - 60_000),
        );
      } catch {
        if (!cancelled) setIframeCapability(null);
      }
    }
    void refreshCapability();
    return () => {
      cancelled = true;
      if (renewalTimer !== null) window.clearTimeout(renewalTimer);
    };
  }, [canvasId, canvas?.kind, iframeRevisionsKey, mintIframeCapability]);
  const iframeCapabilityToken = iframeCapability?.token ?? null;
  const resolvedIframeRevisions = iframeCapability?.revisions ?? iframeRevisions;
  const { file, page, doc, docError, cssReady } = useCanvasDocAndCss(canvas, requestedPageId);
  const activePageId = page?.id ?? (!requestedPageId ? file?.defaultPageId : "") ?? "";
  useDocumentTitle(canvas?.title);

  const workspace = useQuery(
    api.workspaces.getById,
    canvas ? { workspaceId: canvas.workspace_id } : "skip",
  );

  const rename = useMutation(api.canvases.renameMine);
  const remove = useMutation(api.canvases.deleteMine);
  const { notify } = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pagesCollapsed, setPagesCollapsed] = useState(false);
  const [editorMode, setEditorMode] = useState<"design" | "prototype">("design");
  const persistedVersionRef = useRef<number | undefined>(canvasVersion);
  const persistedDraftRevisionRef = useRef<number>(canvas?.draft_revision ?? 0);
  const pendingGeometrySavesRef = useRef(0);
  const geometrySaveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (pendingGeometrySavesRef.current === 0) {
      persistedVersionRef.current = canvasVersion;
      persistedDraftRevisionRef.current = canvas?.draft_revision ?? 0;
    }
  }, [canvasVersion, canvas?.draft_revision]);

  const saveFile = useCallback(
    async (nextFile: CanvasFile, note: string) => {
      if (!canvasId || canvasVersion === undefined) return;
      const saved = await saveCanvasFile({
        canvasId: canvasId as Id<"canvases">,
        fileJson: JSON.stringify(nextFile),
        expectedVersion: canvasVersion,
        expectedDraftRevision: persistedDraftRevisionRef.current,
        note,
      });
      persistedDraftRevisionRef.current = saved.draftRevision;
    },
    [canvasId, canvasVersion, saveCanvasFile],
  );
  /*
   * Held here rather than inside VersionHistory so the "by …" attribution
   * above can reuse it: one subscription, not two, and with exactly the
   * same lifetime it had before — the drawer unmounts when it closes, so
   * this unsubscribes with it.
   */
  const versions = useQuery(
    api.canvases.listVersionsMine,
    detailsOpen && canvasId ? { canvasId: canvasId as Id<"canvases"> } : "skip",
  );
  const canvasAssets = useQuery(
    api.assets.listForCanvasMine,
    detailsOpen && canvasId ? { canvasId: canvasId as Id<"canvases"> } : "skip",
  );
  const lastAuthor = versions?.find((v) => v.isCurrent)?.createdByEmail ?? null;
  function queueGeometryChange(
    change:
      | { kind: "node"; nodeId: string; rect: { x: number; y: number; w: number; h: number } }
      | { kind: "group"; groupId: string; dx: number; dy: number },
  ) {
    if (!canvasId) return;
    pendingGeometrySavesRef.current += 1;
    geometrySaveChainRef.current = geometrySaveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const expectedVersion = persistedVersionRef.current;
        if (expectedVersion === undefined) return;
        const result = await patchGeometry({
          canvasId: canvasId as Id<"canvases">,
          pageId: activePageId,
          change,
          expectedVersion,
          expectedDraftRevision: persistedDraftRevisionRef.current,
        });
        persistedVersionRef.current = result.version;
        persistedDraftRevisionRef.current = result.draftRevision;
      })
      .catch((error: unknown) => {
        notify({
          tone: "error",
          message: error instanceof Error ? error.message : "Unable to save layout",
        });
      })
      .finally(() => {
        pendingGeometrySavesRef.current -= 1;
      });
  }
  // Labelled with the workspace's real name once it resolves. It used to
  // always read "Workspace" and point at "/" until the query landed — so an
  // early click sent you Home, and a fast delete navigated there too.
  const backTo = workspace ? `/w/${workspace.slug}` : "/";
  const backLabel = workspace ? workspace.name : "Workspaces";

  // HTML/PDF/image artifacts own their viewport, including any controls in
  // their top edge. Mark that mode on the app root so global navigation can
  // move to the lower-left utility cluster instead of covering the artifact.
  useEffect(() => {
    const isArtifact = canvas?.kind !== undefined && canvas.kind !== "canvas";
    document.documentElement.classList.toggle("is-artifact-canvas-view", isArtifact);
    return () => document.documentElement.classList.remove("is-artifact-canvas-view");
  }, [canvas?.kind]);

  if (canvas === undefined) {
    return (
      <div className="canvas-page-full">
        <div className="canvas-page-loading">
          <LoadingState />
        </div>
      </div>
    );
  }
  if (canvas === null) {
    return (
      <div className="canvas-page-full">
        <div className="canvas-page-loading">
          <EmptyState
            icon={Unplug}
            title="No canvas at this address."
            hint={<Link to="/">Back to workspaces</Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-page-full">
      {canvas.kind === "canvas" ? (
        <div className="canvas-command-bar">
          <IconLink
            to={backTo}
            icon={ArrowLeft}
            label={`Back to ${backLabel}`}
            className="canvas-command-back"
          />
          <div className="canvas-command-title">
            <span>{canvas.title}</span>
            {canvas.version !== undefined && <small>v{canvas.version}</small>}
            <small className={canvas.dirty ? "canvas-draft-dirty" : undefined}>
              {canvas.dirty
                ? `Autosaved · ${canvas.draft_edit_count} unsaved edit${canvas.draft_edit_count === 1 ? "" : "s"}`
                : "Checkpointed"}
            </small>
          </div>
          <fieldset className="canvas-mode-switch" aria-label="Editor mode">
            <Button
              size="sm"
              variant={editorMode === "design" ? "secondary" : "ghost"}
              onClick={() => setEditorMode("design")}
            >
              Design
            </Button>
            <Button
              size="sm"
              variant={editorMode === "prototype" ? "secondary" : "ghost"}
              onClick={() => setEditorMode("prototype")}
            >
              Prototype
            </Button>
          </fieldset>
          <IconLink
            to={`/c/${canvas.canvas_id}/present`}
            icon={Play}
            label="Present canvas"
            text="Present"
            iconSize={15}
            className="canvas-command-present"
          />
          <IconButton
            icon={Info}
            label="Open canvas details"
            text="Details"
            iconSize={17}
            className="canvas-command-details"
            onClick={() => setDetailsOpen(true)}
            aria-expanded={detailsOpen}
            aria-controls="canvas-details"
          />
        </div>
      ) : (
        <IconButton
          icon={Info}
          label="Open canvas details"
          text="Details"
          iconSize={18}
          className="canvas-artifact-details-trigger"
          onClick={() => setDetailsOpen(true)}
          aria-expanded={detailsOpen}
          aria-controls="canvas-details"
        />
      )}

      <Drawer
        id="canvas-details"
        className="canvas-details"
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Details"
        closeLabel="Close canvas details"
      >
        <div className="canvas-details-identity">
          {/* The rename form replaces the title rather than nesting inside
              it: a heading may only contain phrasing content, so a <form> in
              there is invalid markup. */}
          {editing ? (
            <RenameForm
              initial={canvas.title}
              label="Canvas title"
              onSave={(title) => rename({ canvasId: canvas.canvas_id, title })}
              onDone={() => setEditing(false)}
            />
          ) : (
            <div className="canvas-details-title-row">
              <h3 className="canvas-details-title">{canvas.title}</h3>
              <IconButton
                icon={Pencil}
                label="Rename canvas"
                iconSize={15}
                className="canvas-details-rename"
                onClick={() => setEditing(true)}
              />
            </div>
          )}
          {/* Which version am I looking at, when did an agent last touch it,
              and which agent? The first two were already in the payload; the
              third comes from the version list this drawer already holds. */}
          <p className="muted canvas-details-meta">
            {canvas.version !== undefined && `v${canvas.version} · `}
            <time
              dateTime={new Date(canvas.updated_at).toISOString()}
              title={formatAbsoluteTime(canvas.updated_at)}
            >
              {formatRelativeTime(canvas.updated_at)}
            </time>
            {lastAuthor && ` · by ${lastAuthor}`}
          </p>
          {canvas.description && <p className="muted">{canvas.description}</p>}
          {/* The ref an agent addresses this canvas by — this is where you
              are standing when one asks which canvas you mean. */}
          {workspace && <RefChip refValue={`${workspace.slug}/${canvas.slug}`} />}
        </div>

        <PublishControl
          canvasId={canvas.canvas_id}
          visibility={canvas.visibility}
          publicSlug={canvas.public_slug}
          title={canvas.title}
          version={canvas.version}
          doc={doc}
          artifacts={canvas.artifacts}
        />

        <DrawerSection
          label="Working draft"
          aside={canvas.dirty ? `${canvas.draft_edit_count} unsaved edits` : "Up to date"}
        >
          <p className="muted">
            Autosaved at draft revision {canvas.draft_revision}. Checkpoints are immutable and
            appear in Versions.
          </p>
          <Button
            variant="primary"
            icon={History}
            disabled={!canvas.dirty}
            onClick={async () => {
              try {
                const saved = await checkpoint({
                  canvasId: canvas.canvas_id,
                  expectedDraftRevision: persistedDraftRevisionRef.current,
                  note: "Manual checkpoint",
                });
                persistedDraftRevisionRef.current = saved.draftRevision;
                notify({ message: `Created checkpoint v${saved.version}.` });
              } catch (error) {
                notify(toastError(error, "Couldn't create checkpoint"));
              }
            }}
          >
            Create checkpoint
          </Button>
        </DrawerSection>

        <VersionHistory canvasId={canvas.canvas_id} versions={versions} dirty={canvas.dirty} />

        <DrawerSection
          label="Assets"
          aside={workspace ? <Link to={`/w/${workspace.slug}`}>Open library</Link> : undefined}
        >
          {canvasAssets === undefined ? (
            <p className="muted">Loading assets…</p>
          ) : canvasAssets.length === 0 ? (
            <p className="muted">No library assets are pinned to this canvas.</p>
          ) : (
            <ul className="canvas-asset-list">
              {canvasAssets.map((asset) => (
                <li key={asset.path}>
                  <div>
                    <strong>{asset.name}</strong>
                    <span>{asset.path}</span>
                  </div>
                  <small>
                    r{asset.revision} · {formatBytes(asset.size_bytes)}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </DrawerSection>

        {canvas.kind !== "canvas" && canvas.entry_url && (
          <DrawerSection label="Open">
            {/* Guaranteed path to the artifact. The in-page preview can
                legitimately come up blank (see below), and without this the
                user is simply stuck. */}
            <ButtonLink
              href={canvas.entry_public_url ?? canvas.entry_url}
              variant="secondary"
              icon={ExternalLink}
            >
              Open in a new tab
            </ButtonLink>
            {/* Verified live: agent-authored HTML that measures itself at
                parse time computes a degenerate layout inside a cross-origin
                frame and comes up blank here, while the same URL renders
                instantly at top level. Nothing in this app can fix someone
                else's document, so say so — quietly, at the bottom, rather
                than above the share link as it used to be. */}
            <p className="canvas-preview-hint">
              Some artifacts only lay out correctly at top level. If the frame behind this looks
              blank, that is why.
            </p>
          </DrawerSection>
        )}

        {/* Alone, at the bottom, away from everything reversible. */}
        <div className="canvas-details-danger">
          {/* Navigate in the same tick the delete resolves: `getMine` is
              reactive and would otherwise flip to null under us and flash
              "Canvas not found." */}
          <ConfirmButton
            label="Delete canvas"
            description="Deletes this canvas and every version of it. Permanent."
            onConfirm={async () => {
              const result = await remove({ canvasId: canvas.canvas_id });
              navigate(backTo);
              notify({
                message: `Deleted "${canvas.title}" — ${formatBytes(result.bytes_reclaimed)} freed.`,
              });
            }}
          />
        </div>
      </Drawer>
      {canvas.kind === "canvas" ? (
        <>
          {file && (
            <PagesPanel
              file={file}
              activePageId={activePageId}
              collapsed={pagesCollapsed}
              onCollapsedChange={setPagesCollapsed}
              onSelect={(pageId) => {
                const next = new URLSearchParams(searchParams);
                if (pageId === file.defaultPageId) next.delete("page");
                else next.set("page", pageId);
                next.delete("node");
                setSearchParams(next, { replace: true });
              }}
              onSave={saveFile}
            />
          )}
          {file && activePageId && editorMode === "prototype" && (
            <PrototypePanel file={file} activePageId={activePageId} onSave={saveFile} />
          )}
          {docError && <p className="error-text canvas-page-loading">{docError}</p>}
          {/* `!doc` alone left a genuinely blank page in the window where
              the doc had landed but its compiled CSS had not: the loading
              text was gone and the viewport had not mounted yet. */}
          {(!doc ||
            !cssReady ||
            (doc.nodes.some((node) => node.kind === "iframe" || node.kind === "image") &&
              !iframeCapabilityToken)) &&
            !docError && (
              <div className="canvas-page-loading">
                <LoadingState label="Loading canvas…" />
              </div>
            )}
          {doc &&
            cssReady &&
            (!doc.nodes.some((node) => node.kind === "iframe" || node.kind === "image") ||
              iframeCapabilityToken) && (
              <CanvasViewport
                key={`${canvas.canvas_id}:${activePageId}`}
                doc={doc}
                iframeRevisions={resolvedIframeRevisions}
                version={canvasVersion}
                editable
                canvasRef={workspace ? `${workspace.slug}/${canvas.slug}` : undefined}
                cameraStorageKey={`visual-canvas:camera:${sessionUser?.userId ?? "session"}:${canvas.canvas_id}:${activePageId}`}
                onGeometryChange={(nodeId, rect) =>
                  queueGeometryChange({ kind: "node", nodeId, rect })
                }
                onGroupMove={(groupId, dx, dy) =>
                  queueGeometryChange({ kind: "group", groupId, dx, dy })
                }
                iframeBaseUrl={
                  iframeCapabilityToken
                    ? `${mcpBaseUrl(import.meta.env.VITE_CONVEX_URL as string | undefined)}/i/${iframeCapabilityToken}`
                    : null
                }
              />
            )}
        </>
      ) : canvas.entry_url ? (
        <div
          className={`canvas-artifact-full${
            canvas.kind === "image" ? "" : " canvas-artifact-full-embedded"
          }`}
        >
          {canvas.kind === "image" ? (
            <img src={canvas.entry_url} alt={canvas.title} className="artifact-preview" />
          ) : (
            // The preview is a convenience, not a guarantee: agent-authored
            // HTML that measures itself at parse time lays out to nothing
            // inside a cross-origin frame. `entry_public_url` (the /s/ path)
            // is preferred because a page's own relative refs — ../assets/x —
            // only resolve when it is served under its canvas; it is null for
            // private canvases, which is why the escape hatch sits next to it.
            <iframe
              src={canvas.entry_public_url ?? canvas.entry_url}
              title={canvas.title}
              className="artifact-preview-frame"
            />
          )}
        </div>
      ) : (
        <div className="canvas-page-loading">
          <EmptyState title="No render yet." hint="Ask your agent to render this canvas." />
        </div>
      )}
    </div>
  );
}
