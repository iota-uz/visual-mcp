import { useAction, useMutation, usePaginatedQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { JobRequest } from "../../../../packages/video/src/jobs";
import { Badge } from "./Badge";
import { Button } from "./ui/Button";
import { Disclosure } from "./ui/Disclosure";
import { Checkbox, Select } from "./ui/TextInput";
import { useDurableJobIntent } from "./video/useDurableJobIntent";
export type PinnedImage = { assetId: Id<"assets">; revisionId: Id<"assetVersions"> };
type ImageOutput = { asset: PinnedImage; sha256: string; mimeType: string };
function imageOutputs(value: unknown): ImageOutput[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("kind" in value) ||
    value.kind !== "image" ||
    !("artifacts" in value) ||
    !Array.isArray(value.artifacts)
  )
    return [];
  return value.artifacts.filter(
    (item): item is ImageOutput =>
      !!item &&
      typeof item === "object" &&
      typeof item.sha256 === "string" &&
      typeof item.mimeType === "string" &&
      !!item.asset &&
      typeof item.asset.assetId === "string" &&
      typeof item.asset.revisionId === "string",
  );
}
export function SharedImageStudio({
  workspaceId,
  source,
  onUse,
}: {
  workspaceId: Id<"workspaces">;
  source?: PinnedImage;
  onUse?: (asset: PinnedImage) => Promise<void>;
}) {
  const submit = useMutation(api.videoJobs.submit);
  const cancel = useMutation(api.videoJobs.cancel);
  const jobs = usePaginatedQuery(api.videoJobs.listJobs, { workspaceId }, { initialNumItems: 10 });
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1152x2048");
  const [quality, setQuality] = useState("high");
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const pending = useDurableJobIntent<Parameters<typeof submit>[0]>(
    `image:${workspaceId}:${source ? `${source.assetId}:${source.revisionId}` : "new"}`,
  );
  useEffect(() => {
    if (pending.current?.request.kind === "image") {
      setPrompt(pending.current.request.prompt);
      setSize(pending.current.request.size);
      setQuality(pending.current.request.quality);
      setPaid(true);
      setUncertain(true);
    }
  }, [pending.current]);
  const locked = busy || uncertain || !!pending.current || !pending.ready;
  async function generate() {
    const parsed = JobRequest.safeParse({
      kind: "image",
      allowPaid: true,
      model: "gpt-image-2.5-sunburst",
      prompt,
      size,
      quality,
      references: [],
      ...(source ? { source } : {}),
    });
    if (!parsed.success) {
      setMessage("Check the prompt, dimensions and quality before submitting.");
      return;
    }
    const request = pending.current ?? {
      workspaceId,
      idempotencyKey: crypto.randomUUID(),
      request: parsed.data,
    };
    setBusy(true);
    setMessage("");
    try {
      pending.save(request);
      await submit(request);
      pending.save(null);
      setUncertain(false);
      setPaid(false);
      setMessage(
        "Request saved. A result becomes available only after its bytes are durably stored.",
      );
    } catch (error) {
      const data = error && typeof error === "object" && "data" in error ? error.data : undefined;
      const noEffect =
        data && typeof data === "object" && "effect" in data && data.effect === "not_applied";
      if (noEffect) {
        pending.save(null);
        setUncertain(false);
        setMessage(
          "Request was not applied. Check provider availability and the input before trying again.",
        );
      } else {
        setUncertain(true);
        setMessage(
          "Submission was not confirmed. Retry this identical request, or inspect Production; do not start another generation.",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="shared-image-studio" aria-label="Image studio">
      <h3>{source ? "Edit a pinned image" : "Generate an image"}</h3>
      <p className="video-hint">
        Server OpenAI · gpt-image-2.5-sunburst. Codex can use its built-in imagegen and upload the
        result instead. No provider key is sent to this browser.
      </p>
      {source && (
        <p className="video-hint">
          Source {source.assetId} @ {source.revisionId}. This basic edit creates a new asset; it
          does not overwrite the source.
        </p>
      )}
      <label className="video-field">
        Image direction
        <textarea
          aria-label="Image direction"
          maxLength={32000}
          value={prompt}
          disabled={locked}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <div className="video-field-pair">
        <Select
          id="image-size"
          label="Native output size"
          labelVisible
          value={size}
          disabled={locked}
          onChange={(event) => setSize(event.target.value)}
          options={[
            { value: "1152x2048", label: "Portrait 9:16 · 1152×2048" },
            { value: "1024x1024", label: "Square · 1024×1024" },
            { value: "2048x1152", label: "Landscape 16:9 · 2048×1152" },
          ]}
        />
        <Select
          id="image-quality"
          label="Quality"
          labelVisible
          value={quality}
          disabled={locked}
          onChange={(event) => setQuality(event.target.value)}
          options={["low", "medium", "high", "xhigh", "max", "auto"].map((value) => ({
            value,
            label: value,
          }))}
        />
      </div>
      <Checkbox
        checked={paid}
        disabled={locked}
        onChange={(event) => setPaid(event.target.checked)}
        label="I authorize this paid server generation."
      />
      <Button
        disabled={busy || !pending.ready || !paid || !prompt.trim()}
        onClick={() => void generate()}
      >
        {busy
          ? "Submitting…"
          : uncertain
            ? "Retry the same submission"
            : source
              ? "Create edited candidate"
              : "Generate candidate"}
      </Button>
      {message && <p role="status">{message}</p>}
      {pending.error && <p role="alert">{pending.error}</p>}
      <Disclosure summary="Image production history">
        {jobs.results
          .filter((job) => job.kind === "image")
          .map((job) => (
            <div className="shared-image-job" key={job.jobId}>
              <Badge>{job.state}</Badge>
              <p className="video-hint">{job.stage}</p>
              {job.error && (
                <p role="alert">
                  {job.error.code}: {job.error.message}
                </p>
              )}
              {job.state === "outcome_unknown" && (
                <p className="video-warning">
                  The provider may have processed this request. Do not regenerate as a technical
                  retry.
                </p>
              )}
              {(job.state === "queued" || job.state === "running") && (
                <Button
                  size="sm"
                  onClick={() => {
                    void cancel({ jobId: job.jobId }).catch(() =>
                      setMessage("Cancellation was not confirmed; inspect the job state."),
                    );
                  }}
                >
                  Request cancellation
                </Button>
              )}
              {job.state === "succeeded" &&
                imageOutputs(job.result).map((output) => (
                  <ImageCandidate
                    key={output.asset.revisionId}
                    workspaceId={workspaceId}
                    output={output}
                    onUse={onUse}
                  />
                ))}
            </div>
          ))}
        {jobs.status === "CanLoadMore" && (
          <Button size="sm" onClick={() => jobs.loadMore(10)}>
            More production history
          </Button>
        )}
        {jobs.status === "LoadingFirstPage" && <p role="status">Loading jobs…</p>}
      </Disclosure>
    </section>
  );
}
function ImageCandidate({
  workspaceId,
  output,
  onUse,
}: {
  workspaceId: Id<"workspaces">;
  output: ImageOutput;
  onUse?: (asset: PinnedImage) => Promise<void>;
}) {
  const preview = useAction(api.videoMedia.previewAsset);
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="shared-image-candidate">
      {url ? (
        <img
          src={url}
          alt="Generated candidate — review before use"
          onError={() => {
            setUrl(null);
            setMessage("Preview expired or unavailable. Request a fresh link.");
          }}
        />
      ) : (
        <Button
          size="sm"
          onClick={() => {
            void preview({ workspaceId, asset: output.asset })
              .then((value) => setUrl(value.url))
              .catch(() => setMessage("Pinned image preview unavailable."));
          }}
        >
          Preview stored candidate
        </Button>
      )}
      <p className="video-hint">
        SHA-256 <code>{output.sha256}</code>
      </p>
      {onUse && (
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onUse(output.asset)
              .then(() =>
                setMessage(
                  "Attached to this canvas library. Place it explicitly in the canvas document.",
                ),
              )
              .catch(() =>
                setMessage(
                  "Attachment was not confirmed. Reload the canvas revision before retrying.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          Attach to canvas library
        </Button>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
