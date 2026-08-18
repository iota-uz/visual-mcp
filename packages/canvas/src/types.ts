import { z } from "zod";

/**
 * Node HTML is rendered on the app origin (not a sandboxed iframe), so pan/zoom and
 * keyboard work normally on mockup content. That's only safe because this list is
 * enforced on every write and violations are rejected loudly, not silently stripped
 * (PLAN.md section 2) — silently stripping would let Claude believe unsafe content
 * was accepted as-authored.
 */
const UNSAFE_HTML_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /<script[\s>]/i, reason: "<script> elements are not allowed" },
  { pattern: /\son\w+\s*=/i, reason: "inline event handler attributes (on*=) are not allowed" },
  { pattern: /javascript:/i, reason: "javascript: URLs are not allowed" },
  { pattern: /<iframe[\s>]/i, reason: "<iframe> elements are not allowed" },
  { pattern: /<object[\s>]/i, reason: "<object> elements are not allowed" },
];

export function findUnsafeHtml(html: string): string[] {
  return UNSAFE_HTML_PATTERNS.filter(({ pattern }) => pattern.test(html)).map(
    ({ reason }) => reason,
  );
}

const LANE_ROLES = [
  "actors",
  "primary",
  "secondary",
  "automation",
  "exception",
  "support",
  "system",
  "external",
] as const;
export type LaneRole = (typeof LANE_ROLES)[number];

const NODE_SHAPES = [
  "screen",
  "window",
  "actor",
  "automation",
  "service",
  "registry",
  "decision",
  "note",
] as const;
export type NodeShape = (typeof NODE_SHAPES)[number];

const BADGE_TONES = ["live", "partial", "planned"] as const;
export type BadgeTone = (typeof BADGE_TONES)[number];

const EDGE_KINDS = ["main", "secondary", "sync", "actor", "exception", "external"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

const EDGE_ROUTES = ["auto", "horizontal", "vertical", "orthogonal", "gutter"] as const;
export type EdgeRoute = (typeof EDGE_ROUTES)[number];

const NODE_FRAMES = ["phone", "browser", "window", "none"] as const;
export type NodeFrame = (typeof NODE_FRAMES)[number];

export const LaneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  role: z.enum(LANE_ROLES),
  height: z.number().positive(),
  slots: z.number().int().positive().optional(),
});
export type Lane = z.infer<typeof LaneSchema>;

export const StageSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  label: z.string().min(1),
  summary: z.string().optional(),
});
export type Stage = z.infer<typeof StageSchema>;

export const NodeContentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("html"),
    html: z.string().superRefine((html, ctx) => {
      for (const reason of findUnsafeHtml(html)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: reason });
      }
    }),
    frame: z.enum(NODE_FRAMES).optional(),
    scale: z.number().positive().optional(),
  }),
  z.object({
    type: z.literal("text"),
    body: z.string(),
  }),
]);
export type NodeContent = z.infer<typeof NodeContentSchema>;

export const CanvasNodeSchema = z.object({
  id: z.string().min(1),
  lane: z.string().min(1),
  stage: z.string().min(1),
  slot: z.number().int().nonnegative().optional(),
  shape: z.enum(NODE_SHAPES),
  size: z.object({ w: z.number().positive(), h: z.number().positive() }).optional(),
  caption: z.object({
    title: z.string().min(1),
    subtitle: z.string().optional(),
    tag: z.string().optional(),
  }),
  badge: z.object({ text: z.string().min(1), tone: z.enum(BADGE_TONES) }).optional(),
  content: NodeContentSchema.optional(),
  inspector: z
    .object({
      eyebrow: z.string(),
      title: z.string(),
      copy: z.string(),
      points: z.array(z.string()).optional(),
    })
    .optional(),
});
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;

export const CanvasEdgeSchema = z.object({
  id: z.string().optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(EDGE_KINDS),
  label: z.string().optional(),
  route: z.enum(EDGE_ROUTES).optional(),
  bidirectional: z.boolean().optional(),
});
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;

export const LegendItemSchema = z.object({
  label: z.string().min(1),
  tone: z.enum(BADGE_TONES).optional(),
  role: z.enum(LANE_ROLES).optional(),
});
export type LegendItem = z.infer<typeof LegendItemSchema>;

export const LegendGroupSchema = z.object({
  title: z.string().optional(),
  items: z.array(LegendItemSchema).min(1),
});
export type LegendGroup = z.infer<typeof LegendGroupSchema>;

/**
 * A theme id is opaque here — packages/canvas stays decoupled from
 * packages/runtime's theme registry (PLAN.md section 3: both packages stay
 * Convex-free and portable, and canvas must also run unmodified in the
 * browser where runtime's Node-only deps aren't available). Resolving a
 * theme id to actual tokens is C2 work (PLAN.md section 9).
 */
export type ThemeId = string;

export const CanvasDocSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  theme: z.string().optional(),
  grid: z
    .object({
      stageWidth: z.number().positive().optional(),
      startX: z.number().optional(),
    })
    .optional(),
  lanes: z.array(LaneSchema).min(1),
  stages: z.array(StageSchema).min(1),
  nodes: z.array(CanvasNodeSchema),
  edges: z.array(CanvasEdgeSchema),
  legend: z.array(LegendGroupSchema).optional(),
});
export type CanvasDoc = z.infer<typeof CanvasDocSchema>;

export const DEFAULT_STAGE_WIDTH = 1160;
export const DEFAULT_START_X = 120;
