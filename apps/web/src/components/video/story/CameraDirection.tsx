import { Minus, ZoomIn, ZoomOut } from "lucide-react";
import {
  FRAMING_OPTIONS,
  normalizeCameraMovement,
  normalizeFraming,
} from "../../../../../../packages/video/src/camera";
import { RadioCards } from "../../ui/RadioCards";
import { Select } from "../../ui/TextInput";

const framingOptions = [{ value: "", label: "Not set" }, ...FRAMING_OPTIONS];
const movementOptions = [
  { value: "static", label: "Static", description: "Locked frame", icon: Minus },
  { value: "push-in", label: "Push in", description: "Move closer", icon: ZoomIn },
  { value: "pull-out", label: "Pull out", description: "Reveal context", icon: ZoomOut },
] as const;

export function CameraDirection({
  sceneId,
  framing,
  movement,
  disabled,
  onFraming,
  onMovement,
}: {
  sceneId: string;
  framing: string;
  movement: string;
  disabled: boolean;
  onFraming: (value: string) => void;
  onMovement: (value: "static" | "push-in" | "pull-out") => void;
}) {
  return (
    <section className="video-camera-direction" aria-label="Camera direction">
      <div className="video-camera-direction-heading">
        <strong>Camera direction</strong>
        <span>Controls how the scene is composed and moves</span>
      </div>
      <Select
        id={`scene-shot-${sceneId}`}
        label="Framing"
        labelVisible
        value={framingValue(framing)}
        onChange={(event) => onFraming(event.target.value)}
        disabled={disabled}
        options={framingOptionsWithLegacy(framing)}
      />
      <RadioCards
        label="Movement"
        hint="Choose the motion applied to this scene."
        name={`scene-motion-${sceneId}`}
        value={normalizeCameraMovement(movement)}
        options={[...movementOptions]}
        disabled={disabled}
        onChange={onMovement}
      />
    </section>
  );
}

function framingValue(value: string) {
  const normalized = normalizeFraming(value);
  if (normalized) return normalized;
  const legacy = value.trim();
  if (!legacy || legacy.toLowerCase() === "imported" || legacy.toLowerCase() === "unspecified")
    return "";
  return legacy;
}

function framingOptionsWithLegacy(value: string) {
  const current = framingValue(value);
  if (!current || framingOptions.some((option) => option.value === current)) return framingOptions;
  return [{ value: current, label: `Current: ${current}` }, ...framingOptions];
}
