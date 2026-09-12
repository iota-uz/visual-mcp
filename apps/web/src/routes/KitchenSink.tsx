import type { CanvasPoster } from "@visual-canvas/canvas/poster.js";
import {
  ArrowLeft,
  Ban,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  History,
  Info,
  Menu as MenuIcon,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AssetPreview, type PreviewableAssetKind } from "../components/AssetPreview";
import { Badge } from "../components/Badge";
import { CanvasCard, type CanvasCardRow } from "../components/CanvasCard";
import { CanvasCover } from "../components/CanvasCover";
import { ConfirmButton } from "../components/ConfirmButton";
import { ConnectPanel } from "../components/ConnectPanel";
import { CopyButton } from "../components/CopyButton";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { RenameForm } from "../components/RenameForm";
import { CardGridSkeleton, ListSkeleton } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { Button, ButtonLink, type ButtonVariant } from "../components/ui/Button";
import { CopyableValue, RefChip } from "../components/ui/CopyableValue";
import { Disclosure } from "../components/ui/Disclosure";
import { Drawer } from "../components/ui/Drawer";
import { IconButton, IconLink } from "../components/ui/IconButton";
import { Menu } from "../components/ui/Menu";
import { Panel } from "../components/ui/Panel";
import { SectionHeader } from "../components/ui/SectionHeader";
import { Checkbox, Select, TextInput } from "../components/ui/TextInput";
import { WorkspaceCard, type WorkspaceSummary } from "../components/WorkspaceCard";

/*
 * Every primitive, every variant, every state, on one page — reachable at
 * /dev/kitchen-sink in a dev build only. This repo has no visual-regression
 * tooling and most surfaces sit behind Google sign-in, so without this the
 * only way to look at a button in its disabled state is to reproduce the
 * condition that disables it.
 */

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger", "warning", "google"];

/*
 * The destructive path a ⋯ menu takes: the item stages the action and the
 * confirmation renders *outside* the menu, already armed. Arming inside a
 * menu that closes on click cannot work — the armed tree is not a
 * `role="menuitem"`, so the arrows would not reach it.
 */
function MenuStagedDelete() {
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const { notify } = useToast();
  return (
    <>
      <Menu
        triggerRef={menuRef}
        label="Actions for Fast Settlement"
        items={[
          { id: "rename", label: "Rename", icon: Pencil, onSelect: () => {} },
          { id: "sep", separator: true },
          {
            id: "delete",
            label: "Delete canvas…",
            icon: Trash2,
            danger: true,
            onSelect: () => setConfirming(true),
          },
        ]}
      />
      {confirming && (
        <ConfirmButton
          defaultArmed
          onDisarm={() => setConfirming(false)}
          returnFocusRef={menuRef}
          confirmLabel="Delete canvas"
          description={'Deletes "Fast Settlement" and its share link. Permanent.'}
          onConfirm={async () => notify({ message: "Deleted." })}
        />
      )}
    </>
  );
}

/*
 * Enough geometry to look like a canvas at cover size, and no more: the
 * poster is stored as per-mille rectangles, so these are literal.
 */
const KS_POSTER: CanvasPoster = {
  format: 1,
  ar: 1.6,
  n: 6,
  p: 2,
  rects: [
    { x: 20, y: 60, w: 240, h: 200, r: "actors" },
    { x: 330, y: 40, w: 260, h: 220, r: "primary" },
    { x: 660, y: 90, w: 300, h: 240, k: "iframe" },
    { x: 40, y: 420, w: 220, h: 180, r: "system" },
    { x: 340, y: 460, w: 250, h: 200, r: "automation" },
    { x: 690, y: 500, w: 240, h: 190, r: "exception" },
  ],
};

const KS_CANVAS: CanvasCardRow = {
  canvas_id: "cv_kitchen",
  slug: "fast-settlement",
  title: "Fast settlement",
  description: "Claim intake through payout, with the two exception lanes.",
  kind: "canvas",
  visibility: "public",
  updated_at: Date.now() - 1000 * 60 * 42,
  thumbnail_url: null,
  poster: KS_POSTER,
  static_render_status: "ready",
};

/* The card in every content shape it has to survive: no description, no
   poster at all, a non-canvas kind, and read-only (no ⋯ menu). */
const KS_CANVASES: CanvasCardRow[] = [
  KS_CANVAS,
  {
    ...KS_CANVAS,
    canvas_id: "cv_kitchen_empty",
    slug: "blank",
    title: "A canvas nobody has put anything on yet, with a title long enough to wrap twice",
    description: undefined,
    visibility: "private",
    poster: { format: 1, ar: 1.33, n: 0, p: 1, rects: [] },
    static_render_status: "updating",
  },
  {
    ...KS_CANVAS,
    canvas_id: "cv_kitchen_pdf",
    slug: "policy",
    title: "Policy wording",
    description: "An opaque artifact: no CanvasDoc, so no poster either.",
    kind: "pdf",
    visibility: "private",
    poster: null,
    static_render_status: "ready",
  },
];

const KS_PREVIEW_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#2f9f6e"/><rect x="0.4" y="0.5" width="1.6" height="2" fill="#eaf0fe"/></svg>',
  );

const KS_PREVIEW_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="none" stroke="#2f6df6" stroke-width="2"/><path d="M10 16h12" stroke="#061b36" stroke-width="2"/></svg>',
  );

const KS_PREVIEW_JSON = `data:application/json,${encodeURIComponent(
  JSON.stringify({ title: "OSAGO", count: 2 }, null, 2),
)}`;

const KS_ASSET_PREVIEWS: Array<{ kind: PreviewableAssetKind; name: string; url: string }> = [
  { kind: "image", name: "Claim photo", url: KS_PREVIEW_IMAGE },
  { kind: "svg", name: "Iota mark", url: KS_PREVIEW_SVG },
  { kind: "font", name: "Display", url: "/dev/missing.woff2" },
  { kind: "video", name: "Draft cut", url: "/dev/missing.mp4" },
  { kind: "audio", name: "Throw", url: "/dev/missing.ogg" },
  { kind: "data", name: "Claims", url: KS_PREVIEW_JSON },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ks-section">
      <h2 className="ks-section-title">{title}</h2>
      <div className="ks-section-body">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ks-row">
      <span className="ks-row-label">{label}</span>
      <div className="ks-row-items">{children}</div>
    </div>
  );
}

export function KitchenSinkPage() {
  const { notify } = useToast();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("europrotocol");
  const [checked, setChecked] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [sectionTitle, setSectionTitle] = useState("Fast Settlement");
  const [drawer, setDrawer] = useState<"left" | "right" | null>(null);

  return (
    <div className="page-stack">
      <PageHeader
        title="Kitchen sink"
        subtitle="Every primitive, every variant. Dev builds only."
        crumbs={[{ to: "/", label: "Workspaces" }]}
      />

      <Section title="Button">
        {(["md", "sm"] as const).map((size) => (
          <Row key={size} label={size}>
            {VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} size={size}>
                {variant}
              </Button>
            ))}
          </Row>
        ))}
        <Row label="icon">
          <Button variant="ghost" size="sm" icon={Pencil}>
            Rename
          </Button>
          <Button variant="secondary" size="sm" icon={History}>
            Restore
          </Button>
          <Button variant="danger" size="sm" icon={Trash2}>
            Delete
          </Button>
          <Button variant="primary" iconEnd={ExternalLink}>
            Open
          </Button>
        </Row>
        <Row label="state">
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="primary" busy>
            Publishing…
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Button variant="ghost" disabled>
            Disabled
          </Button>
        </Row>
        <Row label="link">
          <ButtonLink to="/" variant="secondary" icon={ArrowLeft}>
            In-app
          </ButtonLink>
          <ButtonLink href="https://example.com" variant="ghost" size="sm" icon={ExternalLink}>
            External
          </ButtonLink>
        </Row>
      </Section>

      <Section title="Icon control">
        <Row label="bare">
          <IconButton icon={X} label="Close" iconSize={18} />
          <IconButton icon={Search} label="Search" />
          {/* Same control, rendered as a link — the gallery has to show
              both or the pair drifts. */}
          <IconLink to="/" icon={ArrowLeft} label="Back to workspaces" />
        </Row>
        {/* In context: these read as borderless *inside* the command bar,
            which is itself the surface they sit on. */}
        <Row label="command bar">
          <div className="canvas-command-bar canvas-command-bar-public ks-static-bar">
            <div className="canvas-command-lead">
              <Link to="/" className="canvas-command-crumb">
                OSAGO
              </Link>
              <span className="canvas-command-crumb-sep" aria-hidden="true">
                /
              </span>
              <h1 className="canvas-command-name">Fast Settlement</h1>
              <span className="canvas-command-state">
                <span>v3</span>
                <span>Checkpointed</span>
              </span>
            </div>
            <div className="canvas-command-actions">
              <IconButton
                icon={Info}
                label="Open canvas details"
                text="Details"
                iconSize={17}
                className="canvas-command-details"
              />
            </div>
          </div>
        </Row>
        <Row label="floating">
          <IconButton
            icon={MenuIcon}
            label="Open navigation"
            iconSize={19}
            className="ks-static-trigger canvas-navigation-trigger"
          />
          <IconButton
            icon={Info}
            label="Open canvas details"
            text="Details"
            iconSize={18}
            className="ks-static-trigger canvas-artifact-details-trigger"
          />
        </Row>
      </Section>

      <Section title="Menu">
        <Row label="default">
          <Menu
            label="Actions for Claim intake"
            items={[
              { id: "open", label: "Open", icon: ExternalLink, to: "/" },
              {
                id: "copy",
                label: "Copy ref",
                icon: Copy,
                onSelect: () => notify({ message: "Copied." }),
              },
              { id: "rename", label: "Rename", icon: Pencil, onSelect: () => {} },
              { id: "sep", separator: true },
              {
                id: "delete",
                label: "Delete canvas…",
                icon: Trash2,
                danger: true,
                onSelect: () => {},
              },
            ]}
          />
        </Row>
        {/* A trigger can be any IconButton — this is the canvas header's. */}
        <Row label="labelled trigger">
          <Menu
            label="Export"
            className="canvas-export"
            trigger={{
              icon: Download,
              label: "Export canvas",
              text: "Export",
              iconSize: 16,
              trailingIcon: ChevronDown,
              className: "canvas-command-export",
            }}
            items={[
              { id: "png", label: "Export page PNG 1×", onSelect: () => {} },
              { id: "pdf", label: "Export page PDF", onSelect: () => {} },
            ]}
          />
        </Row>
        <Row label="disabled item, opens upward">
          <Menu
            label="Actions for Page 1"
            side="top"
            align="start"
            items={[
              { id: "duplicate", label: "Duplicate", icon: Copy, onSelect: () => {} },
              {
                id: "delete",
                label: "Delete Page…",
                icon: Trash2,
                danger: true,
                disabled: true,
                onSelect: () => {},
              },
            ]}
          />
        </Row>
      </Section>

      <Section title="Field">
        <Row label="text">
          <TextInput
            id="ks-text"
            label="Workspace name"
            labelVisible
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="New workspace name"
          />
        </Row>
        <Row label="search">
          <TextInput
            id="ks-search"
            label="Search canvas nodes"
            className="list-toolbar-search"
            leadingIcon={Search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search canvas nodes…"
            trailingSlot={
              search && (
                <IconButton
                  icon={X}
                  label="Clear search"
                  iconSize={14}
                  className="field-action"
                  onClick={() => setSearch("")}
                />
              )
            }
          />
        </Row>
        <Row label="disabled">
          <TextInput id="ks-disabled" label="Disabled" value="Locked" disabled readOnly />
        </Row>
        <Row label="select">
          <Select
            id="ks-select"
            label="Kind"
            labelVisible
            options={[
              { value: "canvas", label: "Canvas" },
              { value: "html", label: "HTML" },
              { value: "image", label: "Image" },
              { value: "pdf", label: "PDF" },
            ]}
          />
        </Row>
        <Row label="checkbox">
          <Checkbox
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            label="Show 3 revoked or expired tokens"
          />
        </Row>
        <Row label="inline form">
          <form className="inline-form" onSubmit={(e) => e.preventDefault()}>
            <TextInput id="ks-inline" label="New workspace name" placeholder="New workspace name" />
            <Button type="submit" variant="primary">
              Create
            </Button>
          </form>
        </Row>
        <Row label="rename">
          {renaming ? (
            <RenameForm
              initial="Fast Settlement"
              label="Canvas title"
              onSave={async () => setRenaming(false)}
              onDone={() => setRenaming(false)}
            />
          ) : (
            <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setRenaming(true)}>
              Rename
            </Button>
          )}
        </Row>
      </Section>

      <Section title="Confirm">
        <Row label="danger">
          <ConfirmButton
            description="Deletes this canvas and every version of it. Permanent."
            onConfirm={async () => notify({ message: "Deleted." })}
          />
        </Row>
        <Row label="warning">
          <ConfirmButton
            label="Revoke"
            confirmLabel="Really revoke?"
            busyLabel="Revoking…"
            tone="warning"
            icon={Ban}
            description={'Any agent still using "laptop" stops working immediately.'}
            onConfirm={async () => notify({ message: 'Revoked "laptop".' })}
          />
        </Row>
      </Section>

      <Section title="Confirm from a menu">
        <Row label="staged">
          <MenuStagedDelete />
        </Row>
      </Section>

      <Section title="Canvas cover">
        <Row label="poster">
          <span className="ks-cover">
            <CanvasCover kind="canvas" poster={KS_POSTER} />
          </span>
          <CanvasCover kind="canvas" poster={KS_POSTER} size="strip" className="ks-cover" />
          <CanvasCover kind="canvas" poster={KS_POSTER} size="chip" />
        </Row>
        <Row label="empty canvas">
          <span className="ks-cover">
            <CanvasCover kind="canvas" poster={{ format: 1, ar: 1.33, n: 0, p: 1, rects: [] }} />
          </span>
        </Row>
        <Row label="kind plate">
          <span className="ks-cover">
            <CanvasCover kind="pdf" poster={null} />
          </span>
          <span className="ks-cover">
            <CanvasCover kind="image" poster={null} />
          </span>
          <span className="ks-cover">
            <CanvasCover kind="html" poster={null} />
          </span>
        </Row>
        {/* A dead URL is the interesting one: it degrades to the poster
            rather than to "No render yet". Click nothing — the browser
            fails the request and `onError` does the rest. */}
        <Row label="dead render">
          <span className="ks-cover">
            <CanvasCover kind="canvas" poster={KS_POSTER} thumbnailUrl="/dev/no-such-render.png" />
          </span>
        </Row>
      </Section>

      <Section title="Card">
        <Row label="canvas">
          <ul className="card-grid ks-grid">
            {KS_CANVASES.map((canvas) => (
              <CanvasCard
                key={canvas.canvas_id}
                canvas={canvas}
                workspaceSlug="osago"
                onRename={async () => notify({ message: "Renamed." })}
                onDelete={async () => {
                  notify({ message: "Deleted." });
                  return { bytes_reclaimed: 2048 };
                }}
              />
            ))}
          </ul>
        </Row>
        {/* No handlers: the card has to render without a ⋯ menu at all,
            which is how a canvas someone else owns would look. */}
        <Row label="read-only">
          <ul className="card-grid ks-grid">
            <CanvasCard canvas={KS_CANVAS} workspaceSlug="osago" />
          </ul>
        </Row>
        <Row label="workspace">
          <ul className="card-grid ks-grid">
            <WorkspaceCard
              workspace={{
                workspace_id: "ws_kitchen" as WorkspaceSummary["workspace_id"],
                slug: "osago",
                name: "OSAGO",
                description: "Motor third-party liability: intake, adjustment and payout.",
                canvas_count: 3,
                recent: KS_CANVASES.map((canvas) => ({
                  canvas_id: canvas.canvas_id,
                  title: canvas.title,
                  kind: canvas.kind,
                  thumbnail_url: canvas.thumbnail_url,
                  poster: canvas.poster,
                  static_render_status: canvas.static_render_status,
                })),
              }}
              onRename={async () => notify({ message: "Renamed." })}
              onDelete={async () => {
                notify({ message: "Deleted." });
                return { canvases_deleted: 3, bytes_reclaimed: 2048 };
              }}
            />
          </ul>
        </Row>
        <Row label="no content">
          <ul className="card-grid ks-grid">
            <WorkspaceCard
              workspace={{
                workspace_id: "ws_kitchen_bare" as WorkspaceSummary["workspace_id"],
                slug: "kasko",
                name: "KASKO",
                canvas_count: 0,
              }}
              onRename={async () => notify({ message: "Renamed." })}
              onDelete={async () => {
                notify({ message: "Deleted." });
                return { canvases_deleted: 0, bytes_reclaimed: 0 };
              }}
            />
          </ul>
        </Row>
      </Section>

      <Section title="Badge">
        <Row label="tones">
          <Badge tone="neutral">canvas</Badge>
          <Badge tone="success">active</Badge>
          <Badge tone="warning">expired</Badge>
          <Badge tone="danger">revoked</Badge>
          <Badge tone="info">info</Badge>
        </Row>
      </Section>

      <Section title="Copyable">
        <Row label="button">
          <CopyButton value="osago/fast-settlement" label="Copy ref" />
          <CopyButton value="secret" />
        </Row>
        <Row label="ref">
          <RefChip refValue="osago/fast-settlement" />
        </Row>
        <Row label="labelled ref">
          <RefChip refValue="osago/fast-settlement" label="Canvas ref" />
        </Row>
        <Row label="block">
          <CopyableValue
            as="block"
            label="Claude Code"
            value="claude mcp add --transport http visual-canvas https://canvas.iota.uz/mcp --header 'Authorization: Bearer vct_…'"
            copyLabel="Copy command"
          />
        </Row>
        <Row label="link">
          <CopyableValue
            as="link"
            value="https://visual.iota.uz/s/a8f24c1e9b"
            copyLabel="Copy link"
          />
        </Row>
      </Section>

      <Section title="Panel">
        <Row label="tones">
          <Panel className="ks-panel">Plain — the default surface.</Panel>
          <Panel tone="accent" className="ks-panel">
            Accent — something that just succeeded.
          </Panel>
          <Panel tone="warning" className="ks-panel">
            Warning — something breaks outside the app.
          </Panel>
        </Row>
        <Row label="disclosure">
          <Disclosure summary="Connect an agent">
            <p className="muted">Folded-away detail.</p>
          </Disclosure>
        </Row>
      </Section>

      <Section title="Section header">
        <SectionHeader
          as="h3"
          title={sectionTitle}
          onRename={async (name) => {
            setSectionTitle(name);
          }}
          renameLabel="Section title"
          subtitle="v3 · 2 hours ago"
          crumbs={[
            { to: "/", label: "Workspaces" },
            { to: "/w/osago", label: "osago" },
          ]}
          actions={
            <Button variant="ghost" size="sm" icon={Pencil}>
              Rename
            </Button>
          }
        />
      </Section>

      <Section title="Asset preview">
        <Row label="kinds">
          <div className="ks-asset-grid">
            {KS_ASSET_PREVIEWS.map((asset) => (
              <div
                key={asset.kind}
                className={`asset-preview asset-preview-${asset.kind}`}
                data-kind={asset.kind}
              >
                <AssetPreview
                  assetId={`ks-${asset.kind}`}
                  kind={asset.kind}
                  name={asset.name}
                  previewUrl={asset.url}
                  eager
                />
                <span className="asset-kind">{asset.kind}</span>
              </div>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Feedback">
        <Row label="toast">
          <Button variant="secondary" onClick={() => notify({ message: "Published." })}>
            Success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() => notify({ tone: "error", message: "Couldn't publish: network error" })}
          >
            Error toast
          </Button>
        </Row>
        <Row label="loading">
          <LoadingState />
        </Row>
        <Row label="empty">
          <EmptyState title="No canvases yet." hint="Point an agent at this workspace over MCP." />
        </Row>
      </Section>

      <Section title="Skeleton">
        <ListSkeleton rows={2} />
        <CardGridSkeleton cards={3} />
      </Section>

      <Section title="Drawer">
        <Row label="right">
          <Button variant="secondary" icon={Info} onClick={() => setDrawer("right")}>
            Open details
          </Button>
        </Row>
        <Row label="left">
          <Button variant="secondary" icon={MenuIcon} onClick={() => setDrawer("left")}>
            Open navigation
          </Button>
        </Row>
        <Drawer
          open={drawer !== null}
          side={drawer ?? "right"}
          onClose={() => setDrawer(null)}
          title="Canvas details"
          closeLabel="Close canvas details"
        >
          <SectionHeader
            as="h3"
            title="Fast Settlement"
            subtitle="v3 · 2 hours ago"
            crumbs={[
              { to: "/", label: "Workspaces" },
              { to: "/w/osago", label: "osago" },
            ]}
            actions={
              <Button variant="ghost" size="sm" icon={Pencil}>
                Rename
              </Button>
            }
          />
          <RefChip refValue="osago/fast-settlement" />
          <CopyableValue
            as="link"
            value="https://visual.iota.uz/s/a8f24c1e9b"
            copyLabel="Copy link"
          />
          <ConfirmButton
            description="Deletes this canvas and every version of it. Permanent."
            onConfirm={async () => {}}
          />
        </Drawer>
      </Section>

      <Section title="Connect panel">
        <ConnectPanel />
      </Section>
    </div>
  );
}
