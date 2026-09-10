import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Button } from "../ui/Button";
import { Disclosure } from "../ui/Disclosure";
import { Select } from "../ui/TextInput";

const Ref = z.object({ assetId: z.string(), revisionId: z.string() });
const Mappings = z.array(z.object({ sha256: z.string(), mimeType: z.string(), asset: Ref }));
const Versions = z.array(
  z.object({
    language: z.enum(["ru", "uz"]),
    sourceVersionId: z.string(),
    versionId: z.string(),
    manifestSha256: z.string(),
  }),
);
const LegacyVersion = z
  .object({
    id: z.string(),
    hash: z.string(),
    language: z.string().optional(),
    manifest: z
      .object({ review: z.object({ videoHash: z.string().optional() }).passthrough().optional() })
      .passthrough(),
  })
  .passthrough();
export function ReelsArchive({ projectId }: { projectId: Id<"videoProjects"> }) {
  const archive = useQuery(api.videoMigration.getArchive, { projectId });
  const preview = useAction(api.videoMedia.previewAsset);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!archive) return null;
  const versions = Versions.safeParse(archive.nativeVersions);
  const mappings = Mappings.safeParse(archive.assetMap);
  return (
    <Disclosure summary="Original Reels archive">
      <p className="video-warning">
        Imported fixture archive. Original records and feedback identities are preserved but
        unverified. Historical approvals, job states and critic results are not current approvals,
        active work or trusted evidence.
      </p>
      <p className="video-hint">{archive.warning}</p>
      <p className="video-hint">
        Original backup SHA-256: <code>{archive.sourceBackupSha256}</code>
        <br />
        Archive JSON SHA-256: <code>{archive.archiveSha256}</code>
      </p>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError("");
          void preview({ workspaceId: archive.workspaceId, asset: archive.archiveAsset })
            .then((result) => setUrl(result.url))
            .catch(() =>
              setError(
                "Archive download link unavailable. Retry to obtain a fresh authenticated link.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        Get archive download link
      </Button>
      {url && (
        <p>
          <a href={url} target="_blank" rel="noreferrer">
            Download immutable original records (JSON)
          </a>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {versions.success ? (
        <ul>
          {versions.data.map((version) => (
            <li key={version.versionId}>
              {version.language.toUpperCase()}: original {version.sourceVersionId} →{" "}
              <Link
                to={`/v/${projectId}?version=${version.versionId}&language=${version.language}`}
              >
                new native checkpoint
              </Link>
              <p className="video-hint">
                New manifest SHA-256: <code>{version.manifestSha256}</code>. Not the original
                version hash.
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p role="alert">
          Native version mapping is unavailable; original archive remains downloadable.
        </p>
      )}
      {mappings.success && (
        <ArchiveRows
          migrationId={archive._id}
          workspaceId={archive.workspaceId}
          mappings={mappings.data}
        />
      )}
    </Disclosure>
  );
}
function ArchiveRows({
  migrationId,
  workspaceId,
  mappings,
}: {
  migrationId: Id<"videoMigrations">;
  workspaceId: Id<"workspaces">;
  mappings: z.infer<typeof Mappings>;
}) {
  const [kind, setKind] = useState("version");
  return (
    <div className="video-archive-rows">
      <Select
        id="reels-history-kind"
        label="Historical record type"
        labelVisible
        value={kind}
        onChange={(event) => setKind(event.target.value)}
        options={[
          "version",
          "feedback",
          "approval",
          "job",
          "observation",
          "asset",
          "asset-import",
          "run",
        ].map((value) => ({
          value,
          label: value,
        }))}
      />
      <HistoricalPage
        key={kind}
        migrationId={migrationId}
        workspaceId={workspaceId}
        kind={kind}
        mappings={mappings}
      />
    </div>
  );
}
function HistoricalPage({
  migrationId,
  workspaceId,
  kind,
  mappings,
}: {
  migrationId: Id<"videoMigrations">;
  workspaceId: Id<"workspaces">;
  kind: string;
  mappings: z.infer<typeof Mappings>;
}) {
  const rows = usePaginatedQuery(
    api.videoMigration.listRecords,
    { migrationId, kind },
    { initialNumItems: 3 },
  );
  const preview = useAction(api.videoMedia.previewAsset);
  const [media, setMedia] = useState<{ url: string; hash: string; version: string } | null>(null);
  const [error, setError] = useState("");
  return (
    <>
      {rows.results.map((row) => {
        let version: z.infer<typeof LegacyVersion> | null = null;
        if (kind === "version") {
          try {
            const parsed = LegacyVersion.safeParse(JSON.parse(row.data));
            if (parsed.success) version = parsed.data;
          } catch {
            /* Original text remains available without interpreting malformed data. */
          }
        }
        const hash = version?.manifest.review?.videoHash;
        const original = hash
          ? mappings.find((item) => item.sha256 === hash && item.mimeType.startsWith("video/"))
          : undefined;
        return (
          <article className="video-comment" key={row._id}>
            <strong>
              {row.kind} · {row.sourceId}
            </strong>
            {version && (
              <p className="video-hint">
                Original version hash: <code>{version.hash}</code>
              </p>
            )}
            {original && (
              <Button
                size="sm"
                onClick={() => {
                  setError("");
                  void preview({
                    workspaceId,
                    asset: original.asset as {
                      assetId: Id<"assets">;
                      revisionId: Id<"assetVersions">;
                    },
                  })
                    .then((result) =>
                      setMedia({ url: result.url, hash: original.sha256, version: row.sourceId }),
                    )
                    .catch(() =>
                      setError(
                        "Original render is unavailable; its archived record remains preserved.",
                      ),
                    );
                }}
              >
                Preview original MP4
              </Button>
            )}
            <Disclosure summary="Original record (unverified history)">
              <pre className="video-original-record">{row.data}</pre>
            </Disclosure>
          </article>
        );
      })}
      {rows.status === "LoadingFirstPage" && <p role="status">Loading historical records…</p>}
      {rows.status === "Exhausted" && rows.results.length === 0 && (
        <p className="video-hint">No archived records of this type.</p>
      )}
      {rows.status !== "Exhausted" && (
        <Button
          disabled={rows.status === "LoadingFirstPage" || rows.status === "LoadingMore"}
          onClick={() => rows.loadMore(3)}
        >
          Load three more original records
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      {media && (
        <section aria-label="Historical original render">
          <p className="video-warning">
            Original {media.version}, not the new native checkpoint. SHA-256{" "}
            <code>{media.hash}</code>. This preview cannot grant approval.
          </p>
          {/* biome-ignore lint/a11y/useMediaCaption: Historical archived MP4 has no independently mapped captions; never fabricate an original caption track. */}
          <video
            key={media.url}
            controls
            playsInline
            preload="metadata"
            src={media.url}
            aria-label="Original Reels MP4"
            style={{ width: "100%", maxHeight: "60vh" }}
          />
        </section>
      )}
    </>
  );
}
