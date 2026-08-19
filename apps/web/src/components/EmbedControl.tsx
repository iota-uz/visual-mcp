import type { CanvasDoc } from "@visual-canvas/canvas";
import { useMemo, useState } from "react";
import {
  buildEmbedCardUrl,
  buildEmbedClickUrl,
  buildEmbedMarkdown,
  type EmbedTarget,
  embedTargetKey,
} from "../lib/embed";
import { mcpBaseUrl } from "../lib/mcpUrl";
import { CopyableValue } from "./ui/CopyableValue";
import { Select, TextInput } from "./ui/TextInput";

interface PublicArtifact {
  path: string;
  type: "pdf" | "image" | "svg" | "source";
  role: "primary" | "supporting";
}

export function EmbedControl({
  title,
  publicSlug,
  version,
  doc,
  artifacts,
}: {
  title: string;
  publicSlug: string;
  version?: number;
  doc: CanvasDoc | null;
  artifacts: PublicArtifact[];
}) {
  const targets = useMemo<EmbedTarget[]>(
    () => [
      { kind: "canvas", label: `Whole canvas — ${title}` },
      ...(doc?.nodes.map((node) => ({
        kind: "node" as const,
        id: node.id,
        label: `Screen / node — ${node.caption.title}`,
      })) ?? []),
      ...artifacts.map((artifact) => ({
        kind: "artifact" as const,
        id: artifact.path,
        label: `Artifact — ${artifact.path.split("/").pop() ?? artifact.path}`,
      })),
    ],
    [artifacts, doc, title],
  );
  const [targetKey, setTargetKey] = useState("canvas");
  const [versionMode, setVersionMode] = useState<"pinned" | "latest">("pinned");
  const selected = targets.find((target) => embedTargetKey(target) === targetKey) ?? targets[0];
  const defaultAlt = selected?.kind === "canvas" ? title : `${selected?.label ?? title} — ${title}`;
  const [customAlt, setCustomAlt] = useState("");

  if (!selected) return null;

  const publicOrigin = mcpBaseUrl(import.meta.env.VITE_CONVEX_URL as string | undefined);
  const cardUrl = buildEmbedCardUrl({
    publicOrigin,
    publicSlug,
    target: selected,
    version: versionMode === "pinned" ? version : undefined,
  });
  const clickUrl = buildEmbedClickUrl({
    appOrigin: window.location.origin,
    publicOrigin,
    publicSlug,
    target: selected,
  });
  const markdown = buildEmbedMarkdown({ alt: customAlt.trim() || defaultAlt, cardUrl, clickUrl });

  return (
    <div className="embed-control">
      <div className="embed-control-grid">
        <Select
          id="embed-target"
          label="Preview target"
          labelVisible
          value={targetKey}
          onChange={(event) => {
            setTargetKey(event.target.value);
            setCustomAlt("");
          }}
          options={targets.map((target) => ({
            value: embedTargetKey(target),
            label: target.label,
          }))}
        />
        <Select
          id="embed-version"
          label="Preview version"
          labelVisible
          value={versionMode}
          onChange={(event) => setVersionMode(event.target.value as "pinned" | "latest")}
          options={[
            { value: "pinned", label: version ? `Pinned to v${version}` : "Pinned" },
            { value: "latest", label: "Always latest" },
          ]}
        />
      </div>
      <TextInput
        id="embed-alt"
        label="Image description"
        labelVisible
        value={customAlt}
        placeholder={defaultAlt}
        onChange={(event) => setCustomAlt(event.target.value)}
      />
      <a className="embed-card-preview" href={clickUrl} target="_blank" rel="noopener noreferrer">
        <img src={cardUrl} alt="" />
      </a>
      <CopyableValue
        as="block"
        label="GitHub / Markdown"
        value={markdown}
        copyLabel="Copy Markdown"
      />
      <p className="embed-control-note">
        The preview is a public image. Clicking it opens the existing public link; it does not
        create a separate embedded viewer.
      </p>
    </div>
  );
}
