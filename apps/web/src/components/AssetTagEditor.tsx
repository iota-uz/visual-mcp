import { Tag, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "./ui/Button";
import { Drawer } from "./ui/Drawer";

const TAG_LIMIT = 20;
const TAG_MAX_LENGTH = 32;

function normalizeTag(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

interface AssetTagEditorProps {
  assetName: string;
  initialTags: string[];
  open: boolean;
  onClose: () => void;
  onSave: (tags: string[]) => Promise<void>;
}

export function AssetTagEditor({
  assetName,
  initialTags,
  open,
  onClose,
  onSave,
}: AssetTagEditorProps) {
  const [tags, setTags] = useState(initialTags);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTags(initialTags);
    setDraft("");
    setError(null);
    setSaving(false);
    inputRef.current?.focus();
  }, [initialTags, open]);

  function addDraft(current = draft): string[] | null {
    const additions = current.split(",").map(normalizeTag).filter(Boolean);
    if (additions.length === 0) return tags;
    const tooLong = additions.find((tag) => [...tag].length > TAG_MAX_LENGTH);
    if (tooLong) {
      setError(`Tags must be ${TAG_MAX_LENGTH} characters or fewer.`);
      return null;
    }
    const next = [...new Set([...tags, ...additions])];
    if (next.length > TAG_LIMIT) {
      setError(`An asset can have up to ${TAG_LIMIT} tags.`);
      return null;
    }
    setTags(next);
    setDraft("");
    setError(null);
    return next;
  }

  function removeTag(tag: string) {
    setTags((current) => current.filter((item) => item !== tag));
    setError(null);
    inputRef.current?.focus();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addDraft();
      return;
    }
    if (event.key === "Backspace" && !draft && tags.length > 0) {
      event.preventDefault();
      const lastTag = tags.at(-1);
      if (lastTag) removeTag(lastTag);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = addDraft();
    if (!next) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Tags could not be saved.");
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Edit tags"
      closeLabel={`Close tag editor for ${assetName}`}
      className="asset-tag-drawer"
    >
      <form className="asset-tag-form" onSubmit={submit}>
        <div className="asset-tag-heading">
          <Tag size={20} aria-hidden="true" />
          <div>
            <h3>{assetName}</h3>
            <p>Tags make this asset easier to find in the shared library.</p>
          </div>
        </div>

        <label className="asset-tag-input-label" htmlFor="asset-tag-input">
          Tags
        </label>
        <div className="asset-tag-input-shell">
          {tags.map((tag) => (
            <span className="asset-tag-chip" key={tag}>
              {tag}
              <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove ${tag} tag`}>
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id="asset-tag-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={tags.length === 0 ? "Add a tag" : "Add another"}
            autoComplete="off"
          />
        </div>
        <div className="asset-tag-guidance">
          <span>Press Enter or comma to add</span>
          <span>
            {tags.length}/{TAG_LIMIT}
          </span>
        </div>
        {error && (
          <p className="asset-tag-error" role="alert">
            {error}
          </p>
        )}

        <div className="asset-tag-actions">
          <Button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
