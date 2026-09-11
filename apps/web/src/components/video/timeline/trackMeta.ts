import { Captions, Eye, Mic2, Music2, Sparkles } from "lucide-react";

export const TRACK_META = {
  visual: { label: "Video", icon: Eye },
  voice: { label: "Voice", icon: Mic2 },
  music: { label: "Music", icon: Music2 },
  sfx: { label: "SFX", icon: Sparkles },
  caption: { label: "Captions", icon: Captions },
} as const;
