/**
 * Canonical camera vocabulary shared by authoring UIs, agents and render adapters.
 * Persisted legacy drafts may still contain free text; normalize at every boundary
 * and only emit these values for newly-authored data.
 */
export const FRAMINGS = ["extreme-wide", "wide", "medium", "close-up", "extreme-close-up"] as const;

export type Framing = (typeof FRAMINGS)[number];

export const CAMERA_MOVEMENTS = ["static", "push-in", "pull-out"] as const;

export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number];

export const FRAMING_OPTIONS: ReadonlyArray<{
  value: Framing;
  label: string;
}> = [
  { value: "extreme-wide", label: "Extreme wide" },
  { value: "wide", label: "Wide" },
  { value: "medium", label: "Medium" },
  { value: "close-up", label: "Close-up" },
  { value: "extreme-close-up", label: "Extreme close-up" },
];

export function normalizeFraming(value: string | null | undefined): Framing | "" {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  if (normalized === "extreme-wide") return "extreme-wide";
  if (normalized === "wide") return "wide";
  if (normalized === "medium") return "medium";
  if (normalized === "closeup" || normalized === "close-up") return "close-up";
  if (normalized === "extreme-closeup" || normalized === "extreme-close-up")
    return "extreme-close-up";
  return "";
}

export function normalizeCameraMovement(value: string | null | undefined): CameraMovement | "" {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  if (normalized === "static" || normalized === "locked" || normalized === "none") return "static";
  if (normalized === "push-in" || normalized === "pushin" || normalized === "push")
    return "push-in";
  if (normalized === "pull-out" || normalized === "pullout" || normalized === "pull")
    return "pull-out";
  return "";
}

export function cameraMovementInstruction(value: CameraMovement): string {
  if (value === "push-in") return "Smooth camera push-in toward the subject";
  if (value === "pull-out") return "Smooth camera pull-out revealing more context";
  return "Locked-off static camera";
}
