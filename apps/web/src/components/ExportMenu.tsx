import { useAction } from "convex/react";
import { ChevronDown, Download, FileImage, Files, FileText } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  describeExportWarnings,
  type ExportResult,
  exportAllPagesPdf,
  exportErrorMessage,
  exportPage,
} from "../lib/export";
import { Menu } from "./ui/Menu";

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
 * one PDF. The popup and its keyboard contract are the shared Menu; what is
 * left here is what to export.
 */
export function ExportMenu({ canvasId, pageId, onError, onDone }: ExportMenuProps) {
  const request = useAction(api.exports.requestMine);
  const [busy, setBusy] = useState<ExportChoice | null>(null);

  async function run(choice: ExportChoice) {
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

  return (
    <Menu
      label="Export"
      className="canvas-export"
      trigger={{
        icon: Download,
        label: busy ? "Exporting" : "Export canvas",
        text: busy ? "Exporting…" : "Export",
        iconSize: 16,
        trailingIcon: ChevronDown,
        className: "canvas-command-export",
        disabled: busy !== null,
        "aria-busy": busy !== null || undefined,
      }}
      items={[
        {
          id: "png-1x",
          label: "Export page PNG 1×",
          icon: FileImage,
          onSelect: () => void run("png-1x"),
        },
        {
          id: "png-2x",
          label: "Export page PNG 2×",
          icon: FileImage,
          onSelect: () => void run("png-2x"),
        },
        { id: "pdf", label: "Export page PDF", icon: FileText, onSelect: () => void run("pdf") },
        {
          id: "all-pdf",
          label: "Export all pages PDF",
          icon: Files,
          onSelect: () => void run("all-pdf"),
        },
      ]}
    />
  );
}
