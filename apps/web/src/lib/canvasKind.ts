import { FileCode, FileText, ImageIcon, LayoutDashboard, type LucideIcon } from "lucide-react";

/*
 * A canvas with no render has no thumbnail, and a bare grey rectangle is
 * indistinguishable from a broken image. Say what the thing is instead.
 *
 * Shared rather than owned by one route: the workspace gallery and the home
 * lanes both draw this placeholder, and they drifted apart while the map
 * lived in Workspace.tsx — the lane strip rendered an empty box.
 */
export const KIND_ICON: Record<string, LucideIcon> = {
  canvas: LayoutDashboard,
  html: FileCode,
  image: ImageIcon,
  pdf: FileText,
};

/** The icon for a kind, falling back for a kind this build doesn't know. */
export function kindIcon(kind: string): LucideIcon {
  return KIND_ICON[kind] ?? FileCode;
}
