import { useAction } from "convex/react";
import { Download, FileImage, Files, FileText } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  describeExportWarnings,
  type ExportResult,
  exportAllPagesPdf,
  exportErrorMessage,
  exportPage,
} from "../lib/export";
import { IconButton } from "./ui/IconButton";

export interface ExportMenuProps {
  canvasId: Id<"canvases">;
  /** The page the viewer is looking at; the per-page items export it. */
  pageId: string;
  onError: (message: string) => void;
  /** Called after a download started; `message` carries any worker warnings. */
  onDone?: (result: ExportResult, message: string | null) => void;
}

type ExportChoice = "png-1x" | "png-2x" | "pdf" | "all-pdf";

/**
 * The header's Export menu — page PNG at 1× or 2×, page PDF, every page as
 * one PDF. Same keyboard contract as the page ⋯ menu: focus moves into the
 * menu on open, arrows wrap, Escape returns focus to the trigger.
 */
export function ExportMenu({ canvasId, pageId, onError, onDone }: ExportMenuProps) {
  const request = useAction(api.exports.requestMine);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportChoice | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const items = useCallback(
    () =>
      [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])].filter(
        (item) => !item.disabled,
      ),
    [],
  );

  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open, items]);

  // A click anywhere else dismisses the menu without stealing the click.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
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
      close(false);
    }
  }

  async function run(choice: ExportChoice) {
    close(true);
    setBusy(choice);
    try {
      const result =
        choice === "all-pdf"
          ? await exportAllPagesPdf(request, { canvasId })
          : await exportPage(request, {
              canvasId,
              pageId,
              format: choice === "pdf" ? "pdf" : "png",
              scale: choice === "png-2x" ? 2 : 1,
            });
      onDone?.(result, describeExportWarnings(result));
    } catch (error) {
      onError(exportErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const label = busy ? "Exporting…" : "Export";
  return (
    <div className="canvas-export" ref={rootRef}>
      <IconButton
        ref={triggerRef}
        icon={Download}
        label={busy ? "Exporting" : "Export canvas"}
        text={label}
        iconSize={16}
        className="canvas-command-export"
        disabled={busy !== null}
        aria-busy={busy !== null || undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      {open && (
        <div
          ref={menuRef}
          className="canvas-export-menu"
          role="menu"
          aria-label="Export"
          onKeyDown={onMenuKeyDown}
        >
          <button type="button" role="menuitem" onClick={() => run("png-1x")}>
            <FileImage size={14} aria-hidden="true" />
            Export page PNG 1×
          </button>
          <button type="button" role="menuitem" onClick={() => run("png-2x")}>
            <FileImage size={14} aria-hidden="true" />
            Export page PNG 2×
          </button>
          <button type="button" role="menuitem" onClick={() => run("pdf")}>
            <FileText size={14} aria-hidden="true" />
            Export page PDF
          </button>
          <button type="button" role="menuitem" onClick={() => run("all-pdf")}>
            <Files size={14} aria-hidden="true" />
            Export all pages PDF
          </button>
        </div>
      )}
    </div>
  );
}
