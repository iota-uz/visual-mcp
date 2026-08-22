import "@visual-canvas/canvas/theme.css";
import {
  type CanvasDoc,
  type CanvasEdge,
  type CanvasFile,
  CanvasFileSchema,
  type CanvasNode,
  type CommentMarker,
  formatElementRef,
  layoutCanvas,
  mountViewport,
  type Rect as NodeRect,
  type NodeRestorePayload,
  resolveCanvasPage,
  type ViewportController,
} from "@visual-canvas/canvas";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Check,
  Copy,
  ExternalLink,
  GripVertical,
  History,
  Info,
  Lock,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Unplug,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmbedControl } from "../components/EmbedControl";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { RenameForm } from "../components/RenameForm";
import { CanvasSkeleton } from "../components/Skeleton";
import { toastError, useToast } from "../components/Toast";
import { Button, ButtonLink } from "../components/ui/Button";
import { CopyableValue, RefChip } from "../components/ui/CopyableValue";
import { Disclosure } from "../components/ui/Disclosure";
import { Drawer } from "../components/ui/Drawer";
import { IconButton, IconLink } from "../components/ui/IconButton";
import { TextInput } from "../components/ui/TextInput";
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
import { useIframeCapability } from "../lib/useIframeCapability";

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
  onNodesMove,
  onDeleteNodes,
  canvasRef,
  cameraStorageKey,
  immersive = false,
  syncSelectionToUrl = true,
  onIframeStateChange,
  comments,
  activeCommentId,
  onCommentActivate,
  onCommentDraft,
}: {
  doc: CanvasDoc;
  iframeBaseUrl?: string | null;
  iframeRevisions?: Record<string, string> | null;
  version?: number;
  editable?: boolean;
  onGeometryChange?: (
    nodeId: string,
    rect: { x: number; y: number; w: number; h: number },
    previous: { x: number; y: number; w: number; h: number },
  ) => void;
  onGroupMove?: (groupId: string, dx: number, dy: number) => void;
  onNodesMove?: (nodeIds: string[], dx: number, dy: number) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  canvasRef?: string;
  cameraStorageKey?: string;
  immersive?: boolean;
  syncSelectionToUrl?: boolean;
  onIframeStateChange?: (state: { total: number; loaded: number; failed: string[] }) => void;
  /** Passing a handler is what turns the Comment tool and its pins on. */
  comments?: readonly CommentMarker[];
  activeCommentId?: string | null;
  onCommentActivate?: (commentId: string) => void;
  onCommentDraft?: (anchor: { nodeId?: string; point: { x: number; y: number } }) => void;
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
  const onNodesMoveRef = useRef(onNodesMove);
  onNodesMoveRef.current = onNodesMove;
  const onDeleteNodesRef = useRef(onDeleteNodes);
  onDeleteNodesRef.current = onDeleteNodes;
  // Ref, not a dep: this fires on every screen load, and a changing
  // identity in the mount effect's deps would tear the viewport down.
  const onIframeStateChangeRef = useRef(onIframeStateChange);
  onIframeStateChangeRef.current = onIframeStateChange;
  // Refs for the same reason as the handlers above: the panel re-renders on
  // every keystroke in its composer, and a new identity in the mount
  // effect's deps would rebuild the viewport under the user.
  const onCommentActivateRef = useRef(onCommentActivate);
  onCommentActivateRef.current = onCommentActivate;
  const onCommentDraftRef = useRef(onCommentDraft);
  onCommentDraftRef.current = onCommentDraft;
  const commentsEnabled = Boolean(onCommentDraft);
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

  // `comments` is read once for the first paint and then kept current by
  // the effect below; as a dependency it would rebuild the viewport — and
  // its iframes — every time a comment was posted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
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
      onIframeStateChange: (state) => onIframeStateChangeRef.current?.(state),
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
      onGeometryChange: (nodeId, rect, previous) =>
        onGeometryChangeRef.current?.(nodeId, rect, previous),
      onGroupMove: (groupId, dx, dy) => onGroupMoveRef.current?.(groupId, dx, dy),
      onNodesMove: (nodeIds, dx, dy) => onNodesMoveRef.current?.(nodeIds, dx, dy),
      onDeleteNodes: (nodeIds) => onDeleteNodesRef.current?.(nodeIds),
      comments,
      ...(commentsEnabled
        ? {
            onCommentActivate: (commentId: string) => onCommentActivateRef.current?.(commentId),
            onCommentDraft: (anchor: { nodeId?: string; point: { x: number; y: number } }) =>
              onCommentDraftRef.current?.(anchor),
          }
        : {}),
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
  }, [cameraStorageKey, commentsEnabled, editable, immersive, syncSelectionToUrl]);

  useEffect(() => {
    controllerRef.current?.setComments(comments ?? []);
  }, [comments]);

  useEffect(() => {
    controllerRef.current?.setActiveComment(activeCommentId ?? null);
  }, [activeCommentId]);

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

  /*
   * Two elements, not one. `mountViewport` adds its own `.vc-viewport`
   * class to whatever container it is handed, and that class comes from
   * packages/canvas's theme.css, which is deliberately *unlayered* and so
   * outranks every app rule regardless of specificity — including its
   * `width: 100%`.
   *
   * While the host and the viewport were the same element, the app could
   * not size it: the media query that clears the Pages panel
   * (`width: calc(100% - 284px)`) lost to that unlayered `width: 100%`,
   * only its `margin-left` survived, and the whole canvas hung 284px off
   * the right edge of the window — taking the minimap, which sits at
   * `right: 18px`, entirely off-screen. Splitting them lets the engine
   * keep meaning "fill my parent" and gives the app a box it owns.
   */
  return (
    <div className={`vc-viewport-host${immersive ? " vc-immersive" : ""}`}>
      <div ref={containerRef} className="vc-viewport-surface" />
    </div>
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

  /*
   * Unpublishing and replacing the link both kill every link already in
   * circulation, instantly and with no way back — so both arm first, same
   * as a delete. Neither catches on purpose: ConfirmButton stays armed on
   * a rejection and renders the failure inline, and the success toast sits
   * after the await, so it cannot fire for a mutation that never landed.
   */
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

const DOC_FETCH_ATTEMPTS = 4;

/*
 * Deliberately not keyed by user or canvas. Whether you like the rail out
 * of the way is a property of how you work, not of which canvas you are
 * looking at — and the per-user key it started with read `undefined` on the
 * first render, before the session resolved, so it never restored anything.
 */
const PAGES_COLLAPSED_KEY = "visual-canvas:pages-collapsed";

/*
 * Mirrors the `max-width: 899px` branch in surfaces/canvas.css, where the
 * Pages rail stops being a column beside the canvas and becomes an overlay
 * on top of it. Read at click time rather than subscribed to: the only
 * question is what the layout is doing right now.
 */
function isOverlayRail(): boolean {
  return window.matchMedia?.("(max-width: 899px)").matches ?? false;
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

  /*
   * `doc_url` is a freshly minted, time-limited Convex storage URL, and the
   * fetch used to be a single attempt that only re-ran when the URL string
   * itself changed. A transient blip or an expiry therefore left a dead
   * error message with no way forward short of a page reload.
   *
   * The generation ref is what lets `retryDoc` be a plain function call
   * rather than a state bump used as an effect dependency: bumping it
   * makes any in-flight fetch and any pending backoff timer land
   * harmlessly.
   */
  const docGenerationRef = useRef(0);
  const docTimerRef = useRef<number | null>(null);
  const loadDoc = useCallback(() => {
    docGenerationRef.current += 1;
    const generation = docGenerationRef.current;
    if (docTimerRef.current !== null) window.clearTimeout(docTimerRef.current);
    docTimerRef.current = null;
    setDocError(null);
    if (kind !== "canvas" || !docUrl) {
      setFile(null);
      return;
    }

    /*
     * Two failure classes, deliberately handled differently: a transport
     * failure is worth retrying with backoff, because signed URLs expire
     * and networks blink. A schema failure is not — the bytes are wrong,
     * and refetching them produces the same wrong bytes.
     */
    const attemptFetch = (failures: number) => {
      fetch(docUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`Unable to load canvas document (${res.status})`);
          return res.json();
        })
        .then((json) => {
          if (docGenerationRef.current !== generation) return;
          try {
            setFile(CanvasFileSchema.parse(json));
            setDocError(null);
          } catch (error) {
            setDocError(
              `Stored document failed validation: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        })
        .catch((err: unknown) => {
          if (docGenerationRef.current !== generation) return;
          if (failures + 1 >= DOC_FETCH_ATTEMPTS) {
            setDocError(err instanceof Error ? err.message : String(err));
            return;
          }
          docTimerRef.current = window.setTimeout(
            () => attemptFetch(failures + 1),
            Math.min(8_000, 700 * 2 ** failures),
          );
        });
    };

    attemptFetch(0);
  }, [kind, docUrl]);

  useEffect(() => {
    loadDoc();
    return () => {
      docGenerationRef.current += 1;
      if (docTimerRef.current !== null) window.clearTimeout(docTimerRef.current);
      docTimerRef.current = null;
    };
  }, [loadDoc]);

  // Compiled Tailwind CSS for the doc's HTML nodes (PLAN.md section 2) —
  // injected as a page-level <style> tag before the viewport mounts, so
  // Tailwind-classed node mockups aren't unstyled on first paint. `cssReady`
  // starts false so mounting waits for either the fetch to land or for
  // there being nothing to fetch, rather than racing it.
  const [cssReady, setCssReady] = useState(false);
  /*
   * Separate from `docError` on purpose. A failed stylesheet is degraded,
   * not fatal: the nodes still render, just unstyled, so blocking the
   * viewport on it would be worse than showing it. But swallowing the
   * failure entirely — which is what the old bare `.catch(() =>
   * setCssReady(true))` did — left an obviously broken canvas with no
   * explanation anywhere in the UI.
   */
  const [cssError, setCssError] = useState<string | null>(null);
  const activeCssRef = useRef<HTMLStyleElement | null>(null);
  useEffect(() => {
    // Keep the previous stylesheet active while a reactive replacement is
    // fetched. A transient loading state here used to unmount the complete
    // viewport on every version and looked exactly like a page refresh.
    if (!canvas?.css_url) {
      activeCssRef.current?.remove();
      activeCssRef.current = null;
      setCssError(null);
      setCssReady(true);
      return;
    }
    let cancelled = false;
    setCssError(null);
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
      .catch((err: unknown) => {
        if (cancelled) return;
        setCssError(err instanceof Error ? err.message : String(err));
        setCssReady(true);
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
  return {
    file,
    page,
    doc: page?.doc ?? null,
    docError: docError ?? pageError,
    // A missing Page is a content problem, not a transport one — retrying
    // the same bytes would change nothing, so it gets no retry affordance.
    canRetryDoc: docError !== null,
    retryDoc: loadDoc,
    cssError,
    cssReady,
  };
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

/*
 * The per-page ⋯ menu used to declare `role="menu"` with `role="menuitem"`
 * children and implement none of the contract that promises: opening it
 * left focus on the trigger, arrow keys did nothing, and Escape was a
 * document-level listener that closed the menu without giving focus back.
 * A screen-reader user was told "menu" and handed something that only
 * responded to Tab.
 */
function PageActionsMenu({
  pageId,
  pageTitle,
  open,
  canDelete,
  onOpenChange,
  onDuplicate,
  onDelete,
}: {
  pageId: string;
  pageTitle: string;
  open: boolean;
  canDelete: boolean;
  onOpenChange: (open: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items = useCallback(
    () =>
      [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])].filter(
        (item) => !item.disabled,
      ),
    [],
  );

  // Focus moves into the menu on open, which is the part that makes the
  // arrow keys below reachable at all.
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open, items]);

  function close(returnFocus: boolean) {
    onOpenChange(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      // Wraps, as a menu should: ArrowUp from the first item is the
      // fastest way to the destructive one at the bottom.
      list[(index + delta + list.length) % list.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      list.at(-1)?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      // Tabbing out of a menu dismisses it rather than leaving an orphaned
      // popup behind the next control.
      close(false);
    }
  }

  return (
    <div className="canvas-page-actions">
      <IconButton
        ref={triggerRef}
        icon={MoreHorizontal}
        label={`More actions for ${pageTitle}`}
        iconSize={15}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
      />
      {open && (
        <div
          ref={menuRef}
          className="canvas-page-menu"
          role="menu"
          aria-label={`Actions for ${pageTitle}`}
          data-page-menu={pageId}
          onKeyDown={onMenuKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close(true);
              onDuplicate();
            }}
          >
            <Copy size={14} aria-hidden="true" />
            Duplicate
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            disabled={!canDelete}
            onClick={() => {
              close(false);
              onDelete();
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete Page…
          </button>
        </div>
      )}
    </div>
  );
}

/*
 * A page's world, small. The rail listed pages as bare text, so telling
 * "Overview" from "Payment states" meant opening both — and with a canvas
 * of any size the panel was 260px of white space holding three words.
 *
 * Drawn from the doc the panel already has: no fetch, no render pass, just
 * the node rects normalised into the box. Lanes and stages are left out on
 * purpose — at this size they are one flat wash that hides the nodes.
 */
function PageThumb({ doc }: { doc: CanvasDoc }) {
  const nodes = doc.nodes;
  if (nodes.length === 0) {
    return <span className="canvas-page-thumb is-empty" aria-hidden="true" />;
  }
  const left = Math.min(...nodes.map((node) => node.rect.x));
  const top = Math.min(...nodes.map((node) => node.rect.y));
  const right = Math.max(...nodes.map((node) => node.rect.x + node.rect.w));
  const bottom = Math.max(...nodes.map((node) => node.rect.y + node.rect.h));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  return (
    <span className="canvas-page-thumb" aria-hidden="true">
      {nodes.slice(0, 24).map((node) => (
        <i
          key={node.id}
          style={{
            left: `${((node.rect.x - left) / width) * 100}%`,
            top: `${((node.rect.y - top) / height) * 100}%`,
            width: `${Math.max(4, (node.rect.w / width) * 100)}%`,
            height: `${Math.max(6, (node.rect.h / height) * 100)}%`,
          }}
        />
      ))}
    </span>
  );
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
  /*
   * Every page mutation rewrites and revalidates the whole CanvasFile and
   * round-trips it through an OCC-guarded action, which is not instant on a
   * slow link. All six used to be fire-and-forget: no busy state, no catch,
   * so a rejected save was an unhandled rejection and a slow one looked
   * like a dead panel until the list snapped. `commit` is the single place
   * that reports both.
   */
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
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

  /*
   * Serialised rather than queued: two concurrent writes would race the
   * same expectedDraftRevision and one would lose on OCC anyway, so the
   * honest thing is to refuse the second and keep the panel legible.
   */
  const busyRef = useRef(false);
  async function commit(label: string, mutate: () => Promise<void>) {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusyLabel(label);
    try {
      await mutate();
      return true;
    } catch (err: unknown) {
      notify(toastError(err, `Couldn't ${label.toLowerCase()}`));
      return false;
    } finally {
      busyRef.current = false;
      setBusyLabel(null);
    }
  }

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
    const ok = await commit("Create Page", () =>
      onSave(
        CanvasFileSchema.parse({
          ...file,
          pages: [...file.pages, { id, title, order: file.pages.length, doc }],
        }),
        `Create Page: ${title}`,
      ),
    );
    if (!ok) return;
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
    const ok = await commit("Rename Page", () =>
      onSave(
        CanvasFileSchema.parse({
          ...file,
          pages: file.pages.map((page) => (page.id === pageId ? { ...page, title } : page)),
        }),
        `Rename Page: ${title}`,
      ),
    );
    if (!ok) return;
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
    await commit("Reorder Pages", () =>
      onSave(
        CanvasFileSchema.parse({
          ...file,
          pages: pages.map((candidate, order) => ({ ...candidate, order })),
        }),
        `Move Page: ${pageId}`,
      ),
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
    await commit("Reorder Pages", () =>
      onSave(
        CanvasFileSchema.parse({
          ...file,
          pages: pages.map((candidate, order) => ({ ...candidate, order })),
        }),
        `Move Page: ${pageId}`,
      ),
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
    const ok = await commit("Duplicate Page", () =>
      onSave(
        CanvasFileSchema.parse({
          ...file,
          pages: [
            ...file.pages,
            { ...structuredClone(source), id, title, order: file.pages.length },
          ],
        }),
        `Duplicate Page: ${source.title}`,
      ),
    );
    if (ok) onSelect(id);
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
    const ok = await commit("Delete Page", () => onSave(next, `Delete Page: ${pageId}`));
    if (!ok) return;
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
        {!collapsed && (
          <>
            <strong>Pages</strong>
            <span className="canvas-pages-count">{ordered.length}</span>
            {/* Create sits in the header beside Collapse rather than as a
                full-width row of its own: it is a header action, and as a
                row it read as a fourth page in the list. */}
            <IconButton
              icon={Plus}
              label="Create Page"
              iconSize={16}
              disabled={busyLabel !== null}
              onClick={() => setCreating(true)}
            />
          </>
        )}
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
          {creating && (
            <input
              ref={nameInputRef}
              className="canvas-page-name-input"
              aria-label="New Page name"
              value={value}
              disabled={busyLabel !== null}
              onChange={(event) => setValue(event.target.value)}
              /*
               * Blur on an empty field closes the row instead of leaving an
               * orphaned input behind; blur on a typed name commits it,
               * which is what every other inline rename in this app does.
               */
              onBlur={() => {
                if (!value.trim()) {
                  setCreating(false);
                  setValue("");
                  return;
                }
                void createPage();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createPage();
                if (event.key === "Escape") {
                  setCreating(false);
                  setValue("");
                }
              }}
            />
          )}
          {/* The panel's one progress channel: page writes revalidate and
              re-upload the whole file, so "nothing is happening" and "a
              1.5 s save is in flight" used to look identical. */}
          <p
            className="canvas-pages-busy"
            role="status"
            aria-live="polite"
            hidden={busyLabel === null}
          >
            {busyLabel ? `${busyLabel}…` : ""}
          </p>
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
                    /* The active page used to be signalled by a tinted
                       background alone — invisible to a screen reader, and
                       to anyone who cannot separate those two blues. */
                    aria-current={page.id === activePageId ? "page" : undefined}
                    onClick={() => {
                      onSelect(page.id);
                      /*
                       * Below 900px the rail is an overlay covering most of
                       * the canvas, so staying open after a selection hides
                       * the very thing that was just selected. Above it, the
                       * canvas is inset beside the rail and there is nothing
                       * to get out of the way of.
                       */
                      if (isOverlayRail()) onCollapsedChange(true);
                    }}
                    onDoubleClick={() => {
                      setEditingId(page.id);
                      setValue(page.title);
                    }}
                  >
                    <PageThumb doc={page.doc} />
                    <span className="canvas-page-label">
                      <span className="canvas-page-title">{page.title}</span>
                      <small>
                        {page.doc.nodes.length === 1 ? "1 node" : `${page.doc.nodes.length} nodes`}
                        {page.id === file.defaultPageId ? " · default" : ""}
                      </small>
                    </span>
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
                  <PageActionsMenu
                    pageId={page.id}
                    pageTitle={page.title}
                    open={menuPageId === page.id}
                    canDelete={ordered.length > 1}
                    onOpenChange={(next) => setMenuPageId(next ? page.id : null)}
                    onDuplicate={() => void duplicatePage(page.id)}
                    onDelete={() => setPendingDeleteId(page.id)}
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

export interface CommentThread {
  comment_id: string;
  page_id: string;
  node_id?: string;
  point?: { x: number; y: number };
  body: string;
  status: "open" | "completed" | "resolved";
  author_kind: "human" | "agent";
  created_at: number;
  completion?: { summary: string; version: number; draft_revision: number; at: number };
  replies: Array<{
    reply_id: string;
    body: string;
    author_kind: "human" | "agent";
    created_at: number;
  }>;
}

const COMMENT_STATUS_LABEL = {
  open: "Open",
  completed: "Agent says done",
  resolved: "Resolved",
} as const;

/* Workspaces have one person in them, so a human comment is this reader's
   own. When that stops being true this is where a name goes. */
function commentAuthor(kind: "human" | "agent"): string {
  return kind === "agent" ? "Agent" : "You";
}

function CommentByline({ kind, at }: { kind: "human" | "agent"; at: number }) {
  return (
    <span className="canvas-comment-byline">
      <strong>{commentAuthor(kind)}</strong>
      <time dateTime={new Date(at).toISOString()} title={formatAbsoluteTime(at)}>
        {formatRelativeTime(at)}
      </time>
    </span>
  );
}

/*
 * The human half of the loop. The agent's half is the MCP `comment_*` tools;
 * this panel exists so a person can leave the request in the first place and
 * then accept or reject what came back — which is why `resolved` is only
 * reachable from here.
 */
/*
 * Its own component, mounted with a key derived from the anchor: "clear the
 * box when the user points somewhere else" is a remount, not an effect that
 * reaches in and resets state after the fact.
 */
function CommentComposer({
  anchorLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  anchorLabel: string;
  busy: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);
  return (
    <form
      className="canvas-comment-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim()) onSubmit(body.trim());
      }}
    >
      <label>
        {anchorLabel}
        <textarea
          ref={fieldRef}
          value={body}
          rows={3}
          placeholder="What should change here?"
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <div className="canvas-comment-actions">
        <Button size="sm" type="submit" disabled={busy || body.trim().length === 0}>
          Comment
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CommentReplyForm({
  commentId,
  busy,
  onSubmit,
}: {
  commentId: string;
  busy: boolean;
  onSubmit: (body: string) => void;
}) {
  const [body, setBody] = useState("");
  return (
    <form
      className="canvas-comment-reply-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim()) onSubmit(body.trim());
      }}
    >
      <TextInput
        id={`reply-${commentId}`}
        label="Reply to this comment"
        value={body}
        placeholder="Write a reply…"
        onChange={(event: ChangeEvent<HTMLInputElement>) => setBody(event.target.value)}
      />
      <Button size="sm" type="submit" disabled={busy || body.trim().length === 0}>
        Reply
      </Button>
    </form>
  );
}

export function CommentsPanel({
  threads,
  doc,
  draft,
  activeId,
  onDraftChange,
  onActiveChange,
  onCreate,
  onReply,
  onStatus,
  onDelete,
}: {
  threads: CommentThread[];
  doc: CanvasDoc | null;
  draft: { nodeId?: string; point: { x: number; y: number } } | null;
  activeId: string | null;
  onDraftChange: (draft: { nodeId?: string; point: { x: number; y: number } } | null) => void;
  onActiveChange: (commentId: string | null) => void;
  onCreate: (input: {
    nodeId?: string;
    point?: { x: number; y: number };
    body: string;
  }) => Promise<void>;
  onReply: (commentId: string, body: string) => Promise<void>;
  onStatus: (commentId: string, status: "resolved" | "open") => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();
  const nodeTitle = useCallback(
    (nodeId?: string) =>
      nodeId ? (doc?.nodes.find((node) => node.id === nodeId)?.caption.title ?? null) : null,
    [doc],
  );

  async function run(work: () => Promise<void>, failure: string) {
    setBusy(true);
    try {
      await work();
    } catch (err: unknown) {
      notify(toastError(err, failure));
    } finally {
      setBusy(false);
    }
  }

  /* Three buckets, and they are not the same job: `completed` is the
     agent's claim waiting on this reader, `open` is what nobody has
     answered, `resolved` is history. The header counted them already;
     the list now separates them. */
  const awaiting = threads.filter((thread) => thread.status === "completed");
  const openThreads = threads.filter((thread) => thread.status === "open");
  const resolved = threads.filter((thread) => thread.status === "resolved");
  const summary = [
    `${openThreads.length} open`,
    awaiting.length > 0 ? `${awaiting.length} awaiting you` : null,
    resolved.length > 0 ? `${resolved.length} resolved` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const groups = [
    { key: "awaiting", title: "Needs you", items: awaiting },
    { key: "open", title: "Open", items: openThreads },
  ].filter((group) => group.items.length > 0);
  // One bucket needs no heading to explain itself.
  const headed = groups.length > 1 || resolved.length > 0;

  function renderThread(thread: CommentThread) {
    const anchor = thread.node_id
      ? (nodeTitle(thread.node_id) ?? `${thread.node_id} (deleted)`)
      : "Page";
    const isActive = thread.comment_id === activeId;
    return (
      <li
        key={thread.comment_id}
        className={`canvas-comment${isActive ? " is-active" : ""}`}
        data-status={thread.status}
      >
        <button
          type="button"
          className="canvas-comment-head"
          onClick={() => onActiveChange(isActive ? null : thread.comment_id)}
          aria-expanded={isActive}
        >
          <CommentByline kind={thread.author_kind} at={thread.created_at} />
          <span className="canvas-comment-anchor" title={anchor}>
            {anchor}
          </span>
        </button>
        {/* Open is the resting state and says nothing; the other two are
            the ones a reader has to act on. */}
        {thread.status !== "open" && (
          <span className="canvas-comment-status">{COMMENT_STATUS_LABEL[thread.status]}</span>
        )}
        <p className="canvas-comment-body">{thread.body}</p>
        {thread.completion && (
          <div className="canvas-comment-completion">
            <p>{thread.completion.summary}</p>
            {/* The revision is the whole point of `completed`: it tells the
                reader exactly what to go and look at. The block is always
                the agent's, so it says when rather than who again. */}
            <span title={formatAbsoluteTime(thread.completion.at)}>
              v{thread.completion.version} · draft {thread.completion.draft_revision} ·{" "}
              {formatRelativeTime(thread.completion.at)}
            </span>
          </div>
        )}
        {thread.replies.length > 0 && (
          <ul className="canvas-comment-replies">
            {thread.replies.map((reply) => (
              <li key={reply.reply_id} data-author={reply.author_kind}>
                <CommentByline kind={reply.author_kind} at={reply.created_at} />
                <p>{reply.body}</p>
              </li>
            ))}
          </ul>
        )}
        {isActive && (
          <>
            <CommentReplyForm
              commentId={thread.comment_id}
              busy={busy}
              onSubmit={(body) =>
                void run(() => onReply(thread.comment_id, body), "Couldn't post reply")
              }
            />
            <div className="canvas-comment-actions">
              {thread.status !== "resolved" ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Check}
                    disabled={busy}
                    onClick={() =>
                      void run(() => onStatus(thread.comment_id, "resolved"), "Couldn't resolve")
                    }
                  >
                    Resolve
                  </Button>
                  {/* Rejecting the agent's claim without resolving it: the
                      thread goes back on its queue. */}
                  {thread.status === "completed" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={RotateCcw}
                      disabled={busy}
                      onClick={() =>
                        void run(() => onStatus(thread.comment_id, "open"), "Couldn't reopen")
                      }
                    >
                      Not done
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={RotateCcw}
                  disabled={busy}
                  onClick={() =>
                    void run(() => onStatus(thread.comment_id, "open"), "Couldn't reopen")
                  }
                >
                  Reopen
                </Button>
              )}
              {/* Destructive, and last: pushed to its own end of the row so
                  it is never the button next to the cursor. */}
              <span className="canvas-comment-destructive">
                <ConfirmButton
                  icon={Trash2}
                  label="Delete"
                  description="this comment and its replies"
                  onConfirm={() => onDelete(thread.comment_id)}
                />
              </span>
            </div>
          </>
        )}
      </li>
    );
  }

  return (
    <aside className="canvas-comments-panel" aria-label="Comments">
      <header>
        <strong>Comments</strong>
        <span className="canvas-comments-count">{summary}</span>
      </header>
      {draft ? (
        <CommentComposer
          key={`${draft.nodeId ?? "page"}:${Math.round(draft.point.x)}:${Math.round(draft.point.y)}`}
          // Naming the anchor is the difference between "a comment" and "a
          // comment about this".
          anchorLabel={
            draft.nodeId
              ? `On ${nodeTitle(draft.nodeId) ?? draft.nodeId}`
              : `On this page · ${Math.round(draft.point.x)}, ${Math.round(draft.point.y)}`
          }
          busy={busy}
          onCancel={() => onDraftChange(null)}
          onSubmit={(body) =>
            void run(
              () => onCreate({ nodeId: draft.nodeId, point: draft.point, body }),
              "Couldn't post comment",
            )
          }
        />
      ) : (
        <p className="canvas-comments-hint">
          Pick the Comment tool (<kbd>C</kbd>) and click a screen or empty space to leave one.
        </p>
      )}
      {threads.length === 0 ? (
        <p className="canvas-comments-empty">
          No comments on this page yet. Your agent reads open ones over MCP and answers here.
        </p>
      ) : (
        <div className="canvas-comment-groups">
          {groups.map((group) => (
            <section className="canvas-comment-section" key={group.key}>
              {headed && (
                <h3>
                  {group.title}
                  <span className="canvas-comment-section-count">{group.items.length}</span>
                </h3>
              )}
              <ul className="canvas-comment-list">{group.items.map(renderThread)}</ul>
            </section>
          ))}
          {resolved.length > 0 && (
            /* Done, and folded away: the panel is a to-do list, not an
               archive, but the archive is one click below it. */
            <Disclosure
              className="canvas-comments-resolved"
              summary={`Resolved · ${resolved.length}`}
            >
              <ul className="canvas-comment-list">{resolved.map(renderThread)}</ul>
            </Disclosure>
          )}
        </div>
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
  const patchGeometry = useAction(api.canvases.patchGeometryMine);
  const saveCanvasFile = useAction(api.canvases.saveCanvasFileMine);
  const checkpoint = useMutation(api.canvases.checkpointMine);
  const canvasVersion = canvas?.version;
  const iframeRevisions = canvas?.iframe_revisions ?? null;
  const {
    capability: iframeCapability,
    error: iframeCapabilityError,
    retry: retryIframeCapability,
  } = useIframeCapability({
    canvasId,
    enabled: canvas?.kind === "canvas",
    revisions: iframeRevisions,
  });
  const iframeCapabilityToken = iframeCapability?.token ?? null;
  const resolvedIframeRevisions = iframeCapability?.revisions ?? iframeRevisions;
  const { file, page, doc, docError, canRetryDoc, retryDoc, cssError, cssReady } =
    useCanvasDocAndCss(canvas, requestedPageId);
  // Only iframe and image nodes read through the signed `/i/:token` path,
  // so a doc made only of native nodes must not be gated on the mint.
  const needsIframeCapability =
    doc?.nodes.some((node) => node.kind === "iframe" || node.kind === "image") ?? false;
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
  /*
   * Persisted, like the camera already is. It used to reset on every visit,
   * so anyone who preferred the rail out of the way had to collapse it
   * again on every canvas they opened.
   */
  const [pagesCollapsed, setPagesCollapsedState] = useState(() => {
    try {
      return window.localStorage.getItem(PAGES_COLLAPSED_KEY) === "1";
    } catch {
      // Storage is unavailable in privacy modes; the rail just starts open.
      return false;
    }
  });
  const setPagesCollapsed = useCallback((collapsed: boolean) => {
    setPagesCollapsedState(collapsed);
    try {
      window.localStorage.setItem(PAGES_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Same: a preference that cannot be stored is not worth failing on.
    }
  }, []);
  /*
   * In the URL, not in state, for the same reason page and node selection
   * are: the mode is part of where you are. It survives a reload, it is
   * linkable — Present's "set a start frame" hint points straight at
   * ?mode=prototype — and the back button steps through it.
   */
  const editorMode = searchParams.get("mode") === "prototype" ? "prototype" : "design";
  const setEditorMode = useCallback(
    (mode: "design" | "prototype") => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (mode === "prototype") next.set("mode", "prototype");
          else next.delete("mode");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  /*
   * Comments are a canvas-level conversation but read per Page: the pins
   * belong to what is on screen, and a thread about another Page is noise
   * until you go there.
   */
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState<{
    nodeId?: string;
    point: { x: number; y: number };
  } | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const commentThreads = useQuery(
    api.comments.listMine,
    canvasId && canvas?.kind === "canvas" && activePageId
      ? { canvasId: canvasId as Id<"canvases">, pageId: activePageId, status: "all" as const }
      : "skip",
  );
  const createComment = useMutation(api.comments.createMine);
  const replyToComment = useMutation(api.comments.replyMine);
  const setCommentStatus = useMutation(api.comments.setStatusMine);
  const deleteComment = useMutation(api.comments.deleteMine);
  const commentMarkers = useMemo<CommentMarker[]>(
    () =>
      (commentThreads ?? [])
        // A resolved thread has been dealt with; keeping its pin on the
        // canvas would leave the document permanently spotted.
        .filter((thread) => thread.status !== "resolved")
        .map((thread) => ({
          id: thread.comment_id,
          nodeId: thread.node_id,
          point: thread.point,
          status: thread.status,
        })),
    [commentThreads],
  );
  // Everything still on the person's plate: unanswered comments and the
  // ones an agent says it has finished and nobody has confirmed.
  const pendingCommentCount = (commentThreads ?? []).filter(
    (thread) => thread.status !== "resolved",
  ).length;

  const persistedVersionRef = useRef<number | undefined>(canvasVersion);
  const persistedDraftRevisionRef = useRef<number>(canvas?.draft_revision ?? 0);
  const pendingGeometrySavesRef = useRef(0);
  /*
   * The pending count lived only in a ref, so a layout save in flight was
   * invisible: you dragged a node, the DOM moved optimistically, and
   * whether that had reached the server was unknowable until a failure
   * toast appeared — or didn't.
   */
  const [saveState, setSaveState] = useState<"idle" | "saving" | "failed">("idle");
  /*
   * Per-screen load state used to stop at a DOM data-attribute read only by
   * CSS, so a canvas with a dozen embedded screens gave no aggregate signal
   * at all — you could not tell "still loading" from "two of these are
   * permanently broken".
   */
  const [iframeProgress, setIframeProgress] = useState<{
    total: number;
    loaded: number;
    failed: string[];
  }>({ total: 0, loaded: 0, failed: [] });
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
      | { kind: "group"; groupId: string; dx: number; dy: number }
      | { kind: "nodes"; nodeIds: string[]; dx: number; dy: number }
      | { kind: "delete"; nodeIds: string[] }
      | ({ kind: "restore" } & NodeRestorePayload),
    onResult?: (result: { undo?: NodeRestorePayload }) => void,
  ) {
    if (!canvasId) return;
    pendingGeometrySavesRef.current += 1;
    setSaveState("saving");
    let failed = false;
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
        onResult?.(result as { undo?: NodeRestorePayload });
        failed = false;
      })
      .catch((error: unknown) => {
        failed = true;
        notify({
          tone: "error",
          message: error instanceof Error ? error.message : "Unable to save layout",
        });
      })
      .finally(() => {
        pendingGeometrySavesRef.current -= 1;
        // Only the last save in a burst decides the label: intermediate
        // drags settling while a later one is still in flight must not
        // flip the indicator back to idle.
        if (pendingGeometrySavesRef.current === 0) setSaveState(failed ? "failed" : "idle");
      });
  }

  /*
   * Session-local manual-edit history.
   *
   * Deliberately not a global undo over agent edits: the canvas is an OCC
   * document several authors write to, and re-applying an old state over
   * someone else's work is worse than not undoing at all. This stack holds
   * only the gestures this browser tab made, as inverse operations the
   * server can apply to whatever the current document is.
   */
  type ManualEdit =
    | { kind: "nodes"; nodeIds: string[]; dx: number; dy: number }
    | { kind: "node"; nodeId: string; before: NodeRect; after: NodeRect }
    | { kind: "group"; groupId: string; dx: number; dy: number }
    /*
     * `undo` is the payload the server handed back when it performed the
     * delete: the nodes and edges plus the group membership and prototype
     * hotspots they were part of. Only the server can produce it — it deletes
     * against the current document, which may have moved on since this tab
     * last saw it — so it is filled in on the way back and refreshed on every
     * redo of the same edit.
     */
    | { kind: "delete"; nodeIds: string[]; undo: NodeRestorePayload };
  const undoStackRef = useRef<ManualEdit[]>([]);
  const redoStackRef = useRef<ManualEdit[]>([]);
  const HISTORY_LIMIT = 50;

  function recordEdit(edit: ManualEdit) {
    undoStackRef.current = [...undoStackRef.current, edit].slice(-HISTORY_LIMIT);
    // Any new gesture ends the redo branch, as in every editor.
    redoStackRef.current = [];
  }

  function applyEdit(edit: ManualEdit, direction: "undo" | "redo") {
    const sign = direction === "undo" ? -1 : 1;
    switch (edit.kind) {
      case "nodes":
        queueGeometryChange({
          kind: "nodes",
          nodeIds: edit.nodeIds,
          dx: edit.dx * sign,
          dy: edit.dy * sign,
        });
        return;
      case "group":
        queueGeometryChange({
          kind: "group",
          groupId: edit.groupId,
          dx: edit.dx * sign,
          dy: edit.dy * sign,
        });
        return;
      case "node":
        queueGeometryChange({
          kind: "node",
          nodeId: edit.nodeId,
          rect: direction === "undo" ? edit.before : edit.after,
        });
        return;
      default:
        if (direction === "undo") queueGeometryChange({ kind: "restore", ...edit.undo });
        else performNodeDeletion(edit);
    }
  }

  function undoManualEdit() {
    const edit = undoStackRef.current.at(-1);
    if (!edit) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, edit].slice(-HISTORY_LIMIT);
    applyEdit(edit, "undo");
  }

  function redoManualEdit() {
    const edit = redoStackRef.current.at(-1);
    if (!edit) return;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, edit].slice(-HISTORY_LIMIT);
    applyEdit(edit, "redo");
  }

  /*
   * Deletion is the one manual edit that destroys authored content, so it
   * is the one that asks first — and it has to ask from a dialog rather
   * than an inline confirm, because the gesture that starts it is a key
   * press with no control on screen.
   */
  const [pendingDelete, setPendingDelete] = useState<{
    nodes: CanvasNode[];
    edges: CanvasEdge[];
  } | null>(null);

  function requestNodeDeletion(nodeIds: string[]) {
    if (!doc) return;
    const removing = new Set(nodeIds);
    const nodes = doc.nodes.filter((node) => removing.has(node.id));
    if (nodes.length === 0) return;
    const edges = doc.edges.filter(
      (edge) => removing.has(edge.source.nodeId) || removing.has(edge.target.nodeId),
    );
    setPendingDelete({ nodes, edges });
  }

  /**
   * Performs a delete and keeps the edit's undo payload in step with what the
   * server actually removed. Shared by the confirmation dialog and redo.
   */
  function performNodeDeletion(edit: Extract<ManualEdit, { kind: "delete" }>) {
    queueGeometryChange({ kind: "delete", nodeIds: edit.nodeIds }, (result) => {
      if (result.undo) edit.undo = result.undo;
    });
  }

  function confirmNodeDeletion() {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    const edit: Extract<ManualEdit, { kind: "delete" }> = {
      kind: "delete",
      nodeIds: target.nodes.map((node) => node.id),
      // Replaced by the server's payload as soon as the write returns; this
      // is only what this tab can see on its own.
      undo: { nodes: target.nodes, edges: target.edges },
    };
    performNodeDeletion(edit);
    recordEdit(edit);
  }

  /*
   * Window-level, because the shortcut has to work whether focus sits in
   * the viewport or on one of the panels around it — and must not fire
   * while the user is typing a page name.
   */
  useEffect(() => {
    if (canvas?.kind !== "canvas") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.matches("input, textarea, select, [contenteditable='true']")
      )
        return;
      event.preventDefault();
      if (event.shiftKey) redoManualEdit();
      else undoManualEdit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

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
        <CanvasSkeleton label="Loading canvas…" />
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
        <header className="canvas-command-bar">
          {/*
           * A breadcrumb, not a back arrow. The arrow said "somewhere
           * behind you" and nothing else; the workspace's own name says
           * where the canvas actually lives, and is the same link.
           */}
          <div className="canvas-command-lead">
            <Link to={backTo} className="canvas-command-crumb">
              {backLabel}
            </Link>
            <span className="canvas-command-crumb-sep" aria-hidden="true">
              /
            </span>
            <h1 className="canvas-command-name">{canvas.title}</h1>
            <span className="canvas-command-state">
              {canvas.version !== undefined && <span>v{canvas.version}</span>}
              {/* Live write state wins over the stored draft summary: while a
                  drag is being persisted, "Checkpointed" is stale by a second
                  and actively misleading. */}
              <span
                className={
                  saveState === "failed"
                    ? "canvas-save-failed"
                    : canvas.dirty && saveState === "idle"
                      ? "canvas-draft-dirty"
                      : undefined
                }
                role={saveState === "idle" ? undefined : "status"}
              >
                {saveState === "saving"
                  ? "Saving…"
                  : saveState === "failed"
                    ? "Not saved"
                    : canvas.dirty
                      ? `Autosaved · ${canvas.draft_edit_count} unsaved edit${canvas.draft_edit_count === 1 ? "" : "s"}`
                      : "Checkpointed"}
              </span>
            </span>
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
          <div className="canvas-command-actions">
            <IconButton
              icon={MessageSquare}
              label={commentsOpen ? "Hide comments" : "Show comments"}
              text={pendingCommentCount > 0 ? `Comments · ${pendingCommentCount}` : "Comments"}
              iconSize={16}
              className="canvas-command-comments"
              data-open={pendingCommentCount > 0 ? "" : undefined}
              onClick={() => setCommentsOpen((open) => !open)}
              aria-pressed={commentsOpen}
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
            <IconLink
              to={`/c/${canvas.canvas_id}/present`}
              icon={Play}
              label="Present canvas"
              text="Present"
              iconSize={15}
              className="canvas-command-present"
            />
          </div>
        </header>
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

      {pendingDelete && (
        <ConfirmDialog
          title="Delete selection?"
          description={`${pendingDelete.nodes.length} ${
            pendingDelete.nodes.length === 1 ? "node" : "nodes"
          }${
            pendingDelete.edges.length > 0
              ? ` and ${pendingDelete.edges.length} connected ${
                  pendingDelete.edges.length === 1 ? "arrow" : "arrows"
                }`
              : ""
          } will be removed from this page. You can undo this with ⌘Z.`}
          confirmLabel="Delete"
          onConfirm={confirmNodeDeletion}
          onCancel={() => setPendingDelete(null)}
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
          {commentsOpen && canvasId && activePageId && (
            <CommentsPanel
              threads={commentThreads ?? []}
              doc={doc ?? null}
              draft={commentDraft}
              activeId={activeCommentId}
              onDraftChange={setCommentDraft}
              onActiveChange={setActiveCommentId}
              onCreate={async (input) => {
                await createComment({
                  canvasId: canvasId as Id<"canvases">,
                  pageId: activePageId,
                  nodeId: input.nodeId,
                  point: input.nodeId ? undefined : input.point,
                  body: input.body,
                });
                setCommentDraft(null);
              }}
              onReply={async (commentId, body) => {
                await replyToComment({ commentId: commentId as Id<"canvasComments">, body });
              }}
              onStatus={async (commentId, status) => {
                await setCommentStatus({ commentId: commentId as Id<"canvasComments">, status });
              }}
              onDelete={async (commentId) => {
                await deleteComment({ commentId: commentId as Id<"canvasComments"> });
                setActiveCommentId((current) => (current === commentId ? null : current));
              }}
            />
          )}
          {docError && (
            <div className="canvas-page-loading">
              <EmptyState
                icon={Unplug}
                title={
                  canRetryDoc ? "Couldn’t load this canvas’s document." : "This Page isn’t here."
                }
                hint={docError}
                action={
                  canRetryDoc ? (
                    <Button variant="secondary" onClick={retryDoc}>
                      Try again
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}
          {/* Screen progress. Only while something is still in flight or has
              failed — a fully loaded canvas says nothing. */}
          {(iframeProgress.failed.length > 0 ||
            (iframeProgress.total > 0 && iframeProgress.loaded < iframeProgress.total)) && (
            <p
              className="canvas-screens-status"
              data-tone={iframeProgress.failed.length > 0 ? "warning" : "info"}
              role="status"
              aria-live="polite"
            >
              {iframeProgress.failed.length > 0
                ? `${iframeProgress.failed.length} of ${iframeProgress.total} screen${iframeProgress.total === 1 ? "" : "s"} didn’t load. Use Retry on the screen to try again.`
                : `Loading screens… ${iframeProgress.loaded} of ${iframeProgress.total}`}
            </p>
          )}
          {/* Degraded, not fatal — the canvas is on screen behind this. */}
          {!docError && cssError && (
            <p className="canvas-degraded-notice" role="status">
              Styles for this canvas didn’t load, so nodes may look unstyled. {cssError}
            </p>
          )}
          {/* The capability mint is the one gate that can fail terminally
              and still leave a well-formed doc on screen, so it gets a way
              out rather than an indefinite spinner. */}
          {!docError && needsIframeCapability && iframeCapabilityError && (
            <div className="canvas-page-loading">
              <EmptyState
                icon={Unplug}
                title="Couldn’t get permission to load this canvas’s screens."
                hint={iframeCapabilityError}
                action={
                  <Button variant="secondary" onClick={retryIframeCapability}>
                    Try again
                  </Button>
                }
              />
            </div>
          )}
          {/* `!doc` alone left a genuinely blank page in the window where
              the doc had landed but its compiled CSS had not: the loading
              text was gone and the viewport had not mounted yet. */}
          {(!doc || !cssReady || (needsIframeCapability && !iframeCapabilityToken)) &&
            !docError &&
            !iframeCapabilityError && (
              <CanvasSkeleton
                label={
                  // Three gates used to collapse into one undifferentiated
                  // "Loading canvas…", so a slow stylesheet and a slow
                  // permission mint were indistinguishable.
                  !doc
                    ? "Loading canvas…"
                    : !cssReady
                      ? "Loading canvas styles…"
                      : "Preparing screens…"
                }
              />
            )}
          {doc && cssReady && (!needsIframeCapability || iframeCapabilityToken) && (
            <CanvasViewport
              key={`${canvas.canvas_id}:${activePageId}`}
              onIframeStateChange={setIframeProgress}
              doc={doc}
              iframeRevisions={resolvedIframeRevisions}
              version={canvasVersion}
              editable
              canvasRef={workspace ? `${workspace.slug}/${canvas.slug}` : undefined}
              cameraStorageKey={`visual-canvas:camera:${sessionUser?.userId ?? "session"}:${canvas.canvas_id}:${activePageId}`}
              onGeometryChange={(nodeId, rect, previous) => {
                queueGeometryChange({ kind: "node", nodeId, rect });
                recordEdit({ kind: "node", nodeId, before: previous, after: rect });
              }}
              onGroupMove={(groupId, dx, dy) => {
                queueGeometryChange({ kind: "group", groupId, dx, dy });
                recordEdit({ kind: "group", groupId, dx, dy });
              }}
              onNodesMove={(nodeIds, dx, dy) => {
                queueGeometryChange({ kind: "nodes", nodeIds, dx, dy });
                recordEdit({ kind: "nodes", nodeIds, dx, dy });
              }}
              onDeleteNodes={requestNodeDeletion}
              comments={commentMarkers}
              activeCommentId={activeCommentId}
              onCommentActivate={(commentId) => {
                setActiveCommentId(commentId);
                setCommentsOpen(true);
              }}
              onCommentDraft={(anchor) => {
                setCommentDraft(anchor);
                setActiveCommentId(null);
                setCommentsOpen(true);
              }}
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
