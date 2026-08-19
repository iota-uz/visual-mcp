import { z } from "zod";

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
const MATURITY = ["live", "partial", "to-be"] as const;
export type Maturity = (typeof MATURITY)[number];
const EDGE_KINDS = ["main", "secondary", "sync", "actor", "exception", "external"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];
const EDGE_ROUTES = ["straight", "bezier", "orthogonal"] as const;
export type EdgeRoute = (typeof EDGE_ROUTES)[number];
const NODE_FRAMES = ["phone", "browser", "desktop", "none"] as const;
export type NodeFrame = (typeof NODE_FRAMES)[number];
const ANCHOR_SIDES = ["top", "right", "bottom", "left"] as const;
export type AnchorSide = (typeof ANCHOR_SIDES)[number];
const SANDBOX_TOKENS = ["allow-scripts", "allow-forms"] as const;
export type IframeSandboxToken = (typeof SANDBOX_TOKENS)[number];
const PERMISSIONS = ["camera", "microphone", "geolocation", "clipboard-write"] as const;
export type IframePermission = (typeof PERMISSIONS)[number];

export const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export type Point = z.infer<typeof PointSchema>;
export const RectSchema = PointSchema.extend({
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
});
export type Rect = z.infer<typeof RectSchema>;

export const LaneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  role: z.enum(LANE_ROLES),
  rect: RectSchema,
  hint: z.string().optional(),
});
export type Lane = z.infer<typeof LaneSchema>;
export const StageSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  label: z.string().min(1),
  summary: z.string().optional(),
  rect: RectSchema,
});
export type Stage = z.infer<typeof StageSchema>;
export const CanvasLabelSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  rect: RectSchema,
  tone: z.enum(["neutral", "info", "success", "warning", "danger"]).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
});
export type CanvasLabel = z.infer<typeof CanvasLabelSchema>;

export const ConnectorAnchorSchema = z.object({
  id: z.string().min(1),
  side: z.enum(ANCHOR_SIDES),
  offset: z.number().finite().min(0).max(1),
});
export type ConnectorAnchor = z.infer<typeof ConnectorAnchorSchema>;
export const NodeCaptionSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  tag: z.string().optional(),
});
export const NodeInspectorSchema = z.object({
  eyebrow: z.string(),
  title: z.string(),
  copy: z.string(),
  points: z.array(z.string()).optional(),
});
export const NativeBodySchema = z.object({
  text: z.string().optional(),
  points: z.array(z.string()).optional(),
  code: z.string().optional(),
  progress: z
    .object({
      value: z.number().int().nonnegative(),
      total: z.number().int().positive(),
      current: z.boolean().optional(),
    })
    .refine(({ value, total }) => value <= total, "progress value may not exceed total")
    .optional(),
});
export type NativeBody = z.infer<typeof NativeBodySchema>;

const BaseNodeFields = {
  id: z.string().min(1),
  laneId: z.string().min(1).optional(),
  stageId: z.string().min(1).optional(),
  rect: RectSchema,
  caption: NodeCaptionSchema,
  maturity: z.enum(MATURITY).optional(),
  anchors: z.array(ConnectorAnchorSchema).min(1),
  inspector: NodeInspectorSchema.optional(),
};
export const NativeNodeSchema = z.object({
  kind: z.literal("native"),
  ...BaseNodeFields,
  shape: z.enum(NODE_SHAPES),
  body: NativeBodySchema.optional(),
});
export type NativeNode = z.infer<typeof NativeNodeSchema>;

export const IframeSourceSchema = z.object({
  entrypoint: z
    .string()
    .regex(/^\/src\/screens\/[A-Za-z0-9._/-]+\.html$/, {
      message: "iframe entrypoint must be an .html file under /src/screens/",
    })
    .refine((path) => !path.split("/").includes(".."), "iframe entrypoint may not traverse"),
  route: z
    .string()
    .regex(/^#\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/, {
      message: "iframe route must be a local hash route beginning with #/",
    })
    .optional(),
});
export const IframeNodeSchema = z.object({
  kind: z.literal("iframe"),
  ...BaseNodeFields,
  source: IframeSourceSchema,
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  frame: z.object({
    kind: z.enum(NODE_FRAMES),
    radius: z.number().finite().nonnegative().optional(),
    fit: z.enum(["contain", "cover", "stretch"]).optional(),
  }),
  sandbox: z
    .array(z.enum(SANDBOX_TOKENS))
    .default(["allow-scripts", "allow-forms"])
    .refine((tokens) => new Set(tokens).size === tokens.length, "sandbox tokens must be unique"),
  permissions: z
    .array(z.enum(PERMISSIONS))
    .default([])
    .refine((tokens) => new Set(tokens).size === tokens.length, "permissions must be unique"),
  activation: z.literal("double-click").default("double-click"),
});
export type IframeNode = z.infer<typeof IframeNodeSchema>;
export const CanvasNodeSchema = z.discriminatedUnion("kind", [NativeNodeSchema, IframeNodeSchema]);
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;

export const EdgeEndpointSchema = z.object({
  nodeId: z.string().min(1),
  anchorId: z.string().min(1),
});
export const CanvasEdgeSchema = z.object({
  id: z.string().min(1),
  source: EdgeEndpointSchema,
  target: EdgeEndpointSchema,
  kind: z.enum(EDGE_KINDS),
  route: z.object({ type: z.enum(EDGE_ROUTES), waypoints: z.array(PointSchema).optional() }),
  label: z
    .object({
      text: z.string().min(1),
      position: z.number().finite().min(0).max(1).optional(),
      offset: PointSchema.optional(),
    })
    .optional(),
  bidirectional: z.boolean().optional(),
});
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;
export const LegendItemSchema = z.object({
  label: z.string().min(1),
  maturity: z.enum(MATURITY).optional(),
  role: z.enum(LANE_ROLES).optional(),
});
export type LegendItem = z.infer<typeof LegendItemSchema>;
export const LegendGroupSchema = z.object({
  title: z.string().optional(),
  items: z.array(LegendItemSchema).min(1),
});
export type LegendGroup = z.infer<typeof LegendGroupSchema>;
export type ThemeId = string;

export const CanvasDocSchema = z
  .object({
    version: z.literal(2),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    theme: z.string().optional(),
    world: z.object({
      width: z.number().finite().positive(),
      height: z.number().finite().positive(),
    }),
    lanes: z.array(LaneSchema),
    stages: z.array(StageSchema),
    labels: z.array(CanvasLabelSchema).default([]),
    nodes: z.array(CanvasNodeSchema),
    edges: z.array(CanvasEdgeSchema),
    legend: z.array(LegendGroupSchema).optional(),
  })
  .superRefine((doc, ctx) => {
    const unique = (items: { id: string }[], path: string) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.id))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [path, index, "id"],
            message: `duplicate ${path} id "${item.id}"`,
          });
        seen.add(item.id);
      });
      return seen;
    };
    const laneIds = unique(doc.lanes, "lanes");
    const stageIds = unique(doc.stages, "stages");
    unique(doc.labels, "labels");
    const nodeIds = unique(doc.nodes, "nodes");
    unique(doc.edges, "edges");
    const nodeById = new Map(doc.nodes.map((node) => [node.id, node]));
    doc.nodes.forEach((node, index) => {
      if (node.laneId && !laneIds.has(node.laneId))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", index, "laneId"],
          message: `unknown lane "${node.laneId}"`,
        });
      if (node.stageId && !stageIds.has(node.stageId))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", index, "stageId"],
          message: `unknown stage "${node.stageId}"`,
        });
      const anchors = new Set<string>();
      node.anchors.forEach((anchor, anchorIndex) => {
        if (anchors.has(anchor.id))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["nodes", index, "anchors", anchorIndex, "id"],
            message: `duplicate anchor id "${anchor.id}"`,
          });
        anchors.add(anchor.id);
      });
    });
    doc.edges.forEach((edge, index) => {
      for (const [key, endpoint] of [
        ["source", edge.source],
        ["target", edge.target],
      ] as const) {
        if (!nodeIds.has(endpoint.nodeId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["edges", index, key, "nodeId"],
            message: `unknown node "${endpoint.nodeId}"`,
          });
          continue;
        }
        const node = nodeById.get(endpoint.nodeId);
        if (!node?.anchors.some((anchor) => anchor.id === endpoint.anchorId))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["edges", index, key, "anchorId"],
            message: `unknown anchor "${endpoint.anchorId}" on node "${endpoint.nodeId}"`,
          });
      }
    });
  });
export type CanvasDoc = z.infer<typeof CanvasDocSchema>;
