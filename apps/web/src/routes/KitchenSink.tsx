import {
  ArrowLeft,
  Ban,
  ExternalLink,
  History,
  Info,
  Menu,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/Badge";
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
import { DataTable } from "../components/ui/DataTable";
import { Disclosure } from "../components/ui/Disclosure";
import { Drawer } from "../components/ui/Drawer";
import { IconButton, IconLink } from "../components/ui/IconButton";
import { Panel } from "../components/ui/Panel";
import { SectionHeader } from "../components/ui/SectionHeader";
import { Checkbox, Select, TextInput } from "../components/ui/TextInput";

/*
 * Every primitive, every variant, every state, on one page — reachable at
 * /dev/kitchen-sink in a dev build only. This repo has no visual-regression
 * tooling and most surfaces sit behind Google sign-in, so without this the
 * only way to look at a button in its disabled state is to reproduce the
 * condition that disables it.
 */

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger", "warning", "google"];

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
  const [drawer, setDrawer] = useState<"left" | "right" | null>(null);

  return (
    <div className="page-stack">
      <PageHeader
        title="Kitchen sink"
        subtitle="Every primitive, every variant. Dev builds only."
        back={{ to: "/", label: "Workspaces" }}
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
        </Row>
        {/* In context: these read as borderless *inside* the command bar,
            which is itself the surface they sit on. */}
        <Row label="command bar">
          <div className="canvas-command-bar ks-static-bar">
            <IconLink to="/" icon={ArrowLeft} label="Back" className="canvas-command-back" />
            <div className="canvas-command-title">
              <span>Fast Settlement</span>
              <small>v3</small>
            </div>
            <IconButton
              icon={Info}
              label="Open canvas details"
              text="Details"
              iconSize={17}
              className="canvas-command-details"
            />
          </div>
        </Row>
        <Row label="floating">
          <IconButton
            icon={Menu}
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
            className="node-search-field"
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
            value="claude mcp add --transport http visual-canvas https://example.convex.site/mcp --header 'Authorization: Bearer vct_…'"
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

      <Section title="Table">
        <DataTable
          caption="MCP tokens"
          captionVisible
          head={
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          }
        >
          <tr>
            <td>laptop</td>
            <td>
              <code>vct_a8f2…</code>
            </td>
            <td>
              <Badge tone="success">active</Badge>
            </td>
            <td>
              <ConfirmButton label="Revoke" tone="warning" icon={Ban} onConfirm={async () => {}} />
            </td>
          </tr>
          <tr>
            <td>ci</td>
            <td>
              <code>vct_31bd…</code>
            </td>
            <td>
              <Badge tone="danger">revoked</Badge>
            </td>
            <td />
          </tr>
        </DataTable>
      </Section>

      <Section title="Section header">
        <SectionHeader
          as="h3"
          title="Fast Settlement"
          subtitle="v3 · 2 hours ago"
          back={{ to: "/", label: "osago" }}
          actions={
            <Button variant="ghost" size="sm" icon={Pencil}>
              Rename
            </Button>
          }
        />
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
          <Button variant="secondary" icon={Menu} onClick={() => setDrawer("left")}>
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
            back={{ to: "/", label: "osago" }}
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
