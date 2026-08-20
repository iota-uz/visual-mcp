import "@visual-canvas/canvas/theme.css";
import {
  type CanvasDoc,
  CanvasDocSchema,
  formatElementRef,
  layoutCanvas,
  mountViewport,
  type ViewportController,
} from "@visual-canvas/canvas";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  ExternalLink,
  History,
  Info,
  Lock,
  Pencil,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
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
import { formatBytes } from "../lib/formatBytes";
import { formatAbsoluteTime, formatRelativeTime } from "../lib/formatDate";
import { mcpBaseUrl } from "../lib/mcpUrl";
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
  editable = false,
  onGeometryChange,
  canvasRef,
}: {
  doc: CanvasDoc;
  iframeBaseUrl?: string | null;
  iframeRevisions?: Record<string, string> | null;
  editable?: boolean;
  onGeometryChange?: (nodeId: string, rect: { x: number; y: number; w: number; h: number }) => void;
  canvasRef?: string;
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
  const resolveIframeIdentityRef = useRef(resolveIframeIdentity);
  resolveIframeIdentityRef.current = resolveIframeIdentity;
  const resolveIframeUrlRef = useRef(resolveIframeUrl);
  resolveIframeUrlRef.current = resolveIframeUrl;

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

    const controller = mountViewport({
      container,
      canvas: positioned,
      editable,
      resolveIframeUrl: (node) =>
        resolveIframeUrlRef.current?.(node) ??
        `${node.source.entrypoint}${node.source.route ?? ""}`,
      resolveIframeIdentity: (node) => resolveIframeIdentityRef.current(node),
      onSelect: (nodeId) => {
        /*
         * `replace`, not push. Selection is view state, not navigation: the
         * URL exists so a selected node can be linked and reloaded, and the
         * viewport has no listener for the reverse direction, so a pushed
         * entry would rewind the URL while leaving the node visibly
         * selected — and 15 node clicks would cost 15 Backs to leave the
         * page. Escape (handled inside the viewport) is the deselect.
         */
        setSearchParamsRef.current(nodeId ? { node: nodeId } : {}, { replace: true });
      },
      onGeometryChange: (nodeId, rect) => onGeometryChangeRef.current?.(nodeId, rect),
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

    // Read the deep-linked node directly from the URL rather than the
    // reactive `useSearchParams` value on purpose — this effect should only
    // re-run when `doc` changes, not on every node selection (which also
    // updates the URL's search params via setSearchParams above).
    const initialNode = new URLSearchParams(window.location.search).get("node");
    if (initialNode) controller.selectNode(initialNode, true);

    return () => {
      controllerRef.current = null;
      controller.dispose();
    };
  }, [editable]);

  useEffect(() => {
    try {
      controllerRef.current?.updateCanvas(layoutCanvas(doc), {
        resolveIframeUrl,
        resolveIframeIdentity,
      });
    } catch {
      // Keep the last valid reactive document visible if a new one cannot lay out.
    }
  }, [doc, resolveIframeIdentity, resolveIframeUrl]);

  return <div ref={containerRef} className="vc-viewport-host" />;
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
      // Restoring just re-points `currentVersionId` — nothing is destroyed
      // and no new version is minted — so without this the only signal is
      // the document quietly changing underneath you.
      notify({ message: `Restored v${version}.` });
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
// non-destructive — `restoreVersion` only re-points `currentVersionId` at an
// existing version, minting nothing and discarding nothing — so unlike delete
// it needs no armed confirmation. Only the current version's row has no
// button, since restoring it would be a no-op.
function VersionHistory({
  canvasId,
  versions,
}: {
  canvasId: Id<"canvases">;
  versions: CanvasVersion[] | undefined;
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
            {!v.isCurrent && (
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
}

// Shared by CanvasPage (signed-in) and PublicCanvasPage (anonymous
// /s/:slug) — both resolve a canvas summary first, then need this same
// doc-fetch-and-validate plus compiled-Tailwind-CSS-injection sequence.
export function useCanvasDocAndCss(canvas: FetchableCanvas | null | undefined) {
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
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
      setDoc(null);
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
        const parsed = CanvasDocSchema.safeParse(json);
        if (!parsed.success) {
          setDocError(`Stored document failed validation: ${parsed.error.message}`);
          return;
        }
        setDoc(parsed.data);
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

  return { doc, docError, cssReady };
}

export function CanvasPage() {
  const { canvasId } = useParams<{ canvasId: string }>();
  const canvas = useQuery(
    api.canvases.getMine,
    canvasId ? { canvasId: canvasId as Id<"canvases"> } : "skip",
  );
  const mintIframeCapability = useMutation(api.canvases.mintIframeCapabilityMine);
  const patchNodeRect = useAction(api.canvases.patchNodeRectMine);
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
  const { doc, docError, cssReady } = useCanvasDocAndCss(canvas);
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
  const persistedVersionRef = useRef<number | undefined>(canvasVersion);
  const pendingGeometrySavesRef = useRef(0);
  const geometrySaveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (pendingGeometrySavesRef.current === 0) persistedVersionRef.current = canvasVersion;
  }, [canvasVersion]);
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
          </div>
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

        <VersionHistory canvasId={canvas.canvas_id} versions={versions} />

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
          {docError && <p className="error-text canvas-page-loading">{docError}</p>}
          {/* `!doc` alone left a genuinely blank page in the window where
              the doc had landed but its compiled CSS had not: the loading
              text was gone and the viewport had not mounted yet. */}
          {(!doc ||
            !cssReady ||
            (doc.nodes.some((node) => node.kind === "iframe") && !iframeCapabilityToken)) &&
            !docError && (
              <div className="canvas-page-loading">
                <LoadingState label="Loading canvas…" />
              </div>
            )}
          {doc &&
            cssReady &&
            (!doc.nodes.some((node) => node.kind === "iframe") || iframeCapabilityToken) && (
              <CanvasViewport
                key={canvas.canvas_id}
                doc={doc}
                iframeRevisions={resolvedIframeRevisions}
                editable
                canvasRef={workspace ? `${workspace.slug}/${canvas.slug}` : undefined}
                onGeometryChange={(nodeId, rect) => {
                  if (!canvasId) return;
                  pendingGeometrySavesRef.current += 1;
                  geometrySaveChainRef.current = geometrySaveChainRef.current
                    .catch(() => undefined)
                    .then(async () => {
                      const expectedVersion = persistedVersionRef.current;
                      if (expectedVersion === undefined) return;
                      const result = await patchNodeRect({
                        canvasId: canvasId as Id<"canvases">,
                        nodeId,
                        rect,
                        expectedVersion,
                      });
                      persistedVersionRef.current = result.version;
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
