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
  // Standalone gallery/reference nodes do not need connector geometry.
  // Edge validation below still requires referenced anchors to exist.
  anchors: z.array(ConnectorAnchorSchema).default([]),
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
export const IframeNodeSchema = z
  .object({
    kind: z.literal("iframe"),
    ...BaseNodeFields,
    source: IframeSourceSchema,
    viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
    frame: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("phone"),
          time: z
            .string()
            .regex(/^(?:[01]\d|2[0-3]|\d):[0-5]\d$/)
            .default("09:42"),
        })
        .strict(),
      z
        .object({
          kind: z.enum(["browser", "desktop", "none"]),
          radius: z.number().finite().nonnegative().optional(),
          fit: z.enum(["contain", "cover", "stretch"]).optional(),
        })
        .strict(),
    ]),
    sandbox: z
      .array(z.enum(SANDBOX_TOKENS))
      .default(["allow-scripts", "allow-forms"])
      .refine((tokens) => new Set(tokens).size === tokens.length, "sandbox tokens must be unique"),
    permissions: z
      .array(z.enum(PERMISSIONS))
      .default([])
      .refine((tokens) => new Set(tokens).size === tokens.length, "permissions must be unique"),
    activation: z.literal("double-click").default("double-click"),
  })
  .superRefine((node, ctx) => {
    if (node.frame.kind !== "phone") return;
    if (node.viewport.width !== 284 || node.viewport.height !== 642) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["viewport"],
        message: "phone iframe viewport must be the canonical 284x642 content area",
      });
    }
  });
export type IframeNode = z.infer<typeof IframeNodeSchema>;
export const ImageNodeSchema = z
  .object({
    kind: z.literal("image"),
    ...BaseNodeFields,
    source: z.object({
      path: z
        .string()
        .regex(/^\/(?:assets|src)\/[A-Za-z0-9._/-]+$/, "image path must be under /assets or /src")
        .refine((path) => !path.split("/").includes(".."), "image path may not traverse"),
    }),
    fit: z.enum(["contain", "cover", "fill", "none"]).default("contain"),
    focalPosition: z
      .object({
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
      })
      .default({ x: 0.5, y: 0.5 }),
    alt: z.string().min(1),
  })
  .strict();
export type ImageNode = z.infer<typeof ImageNodeSchema>;
// IframeNodeSchema carries cross-field viewport validation, so it is a
// ZodEffects rather than a bare object. A regular union preserves the useful
// TypeScript discriminant while still running those refinements.
export const CanvasNodeSchema = z.union([NativeNodeSchema, IframeNodeSchema, ImageNodeSchema]);
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
    world: z
      .object({
        width: z.number().finite().positive().max(1_000_000),
        height: z.number().finite().positive().max(1_000_000),
      })
      .strict(),
    lanes: z.array(LaneSchema).max(200).default([]),
    stages: z.array(StageSchema).max(200).default([]),
    labels: z.array(CanvasLabelSchema).max(500).default([]),
    nodes: z.array(CanvasNodeSchema).max(1_000).default([]),
    edges: z.array(CanvasEdgeSchema).max(3_000).default([]),
    legend: z.array(LegendGroupSchema).max(50).optional(),
  })
  .strict()
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

export const CanvasPageSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "page id must be a lowercase URL-safe slug"),
    title: z.string().min(1).max(120),
    order: z.number().int().nonnegative(),
    doc: CanvasDocSchema,
  })
  .strict();
export type CanvasPage = z.infer<typeof CanvasPageSchema>;

export const PrototypeTargetSchema = z
  .object({ pageId: z.string().min(1), nodeId: z.string().min(1) })
  .strict();
export type PrototypeTarget = z.infer<typeof PrototypeTargetSchema>;

export const PrototypeInteractionSchema = z
  .object({
    id: z.string().min(1).max(120),
    source: PrototypeTargetSchema,
    hotspot: z
      .object({
        x: z.number().finite().nonnegative(),
        y: z.number().finite().nonnegative(),
        width: z.number().finite().positive(),
        height: z.number().finite().positive(),
      })
      .strict(),
    trigger: z.enum(["tap", "click"]).default("tap"),
    destination: PrototypeTargetSchema,
    transition: z.enum(["instant", "dissolve", "slide-left", "slide-right"]).default("instant"),
  })
  .strict();
export type PrototypeInteraction = z.infer<typeof PrototypeInteractionSchema>;

export const CanvasPrototypeSchema = z
  .object({
    start: PrototypeTargetSchema.optional(),
    interactions: z.array(PrototypeInteractionSchema).max(2_000).default([]),
  })
  .strict();
export type CanvasPrototype = z.infer<typeof CanvasPrototypeSchema>;

/**
 * A complete canvas file. Pages own independent CanvasDoc worlds while files,
 * assets, checkpoints, publication and prototype interactions remain atomic at
 * the file level.
 */
export const CanvasFileSchema = z
  .object({
    version: z.literal(3),
    defaultPageId: z.string().min(1),
    pages: z.array(CanvasPageSchema).min(1).max(100),
    prototype: CanvasPrototypeSchema.default({ interactions: [] }),
  })
  .strict()
  .superRefine((file, ctx) => {
    const pageIds = new Set<string>();
    const pageOrders = new Set<number>();
    const pages = new Map<string, CanvasPage>();
    file.pages.forEach((page, index) => {
      if (pageIds.has(page.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pages", index, "id"],
          message: `duplicate page id "${page.id}"`,
        });
      if (pageOrders.has(page.order))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pages", index, "order"],
          message: `duplicate page order ${page.order}`,
        });
      pageIds.add(page.id);
      pageOrders.add(page.order);
      pages.set(page.id, page);
    });
    if (!pageIds.has(file.defaultPageId))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultPageId"],
        message: `unknown default page "${file.defaultPageId}"`,
      });

    const resolveTarget = (target: PrototypeTarget, path: (string | number)[]) => {
      const page = pages.get(target.pageId);
      if (!page) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, "pageId"],
          message: `unknown prototype page "${target.pageId}"`,
        });
        return undefined;
      }
      const node = page.doc.nodes.find((candidate) => candidate.id === target.nodeId);
      if (!node)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, "nodeId"],
          message: `unknown prototype node "${target.nodeId}" on page "${target.pageId}"`,
        });
      return node;
    };

    if (file.prototype.start) resolveTarget(file.prototype.start, ["prototype", "start"]);
    const interactionIds = new Set<string>();
    file.prototype.interactions.forEach((interaction, index) => {
      const base = ["prototype", "interactions", index] as (string | number)[];
      if (interactionIds.has(interaction.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...base, "id"],
          message: `duplicate prototype interaction id "${interaction.id}"`,
        });
      interactionIds.add(interaction.id);
      const source = resolveTarget(interaction.source, [...base, "source"]);
      resolveTarget(interaction.destination, [...base, "destination"]);
      if (!source) return;
      const width = source.kind === "iframe" ? source.viewport.width : source.rect.w;
      const height = source.kind === "iframe" ? source.viewport.height : source.rect.h;
      if (
        interaction.hotspot.x + interaction.hotspot.width > width ||
        interaction.hotspot.y + interaction.hotspot.height > height
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...base, "hotspot"],
          message: `hotspot must stay inside source viewport ${width}x${height}`,
        });
    });
  });
export type CanvasFile = z.infer<typeof CanvasFileSchema>;

export function orderedCanvasPages(file: CanvasFile): CanvasPage[] {
  return [...file.pages].sort((left, right) => left.order - right.order);
}

export function resolveCanvasPage(file: CanvasFile, pageId?: string | null): CanvasPage {
  const page =
    file.pages.find((page) => page.id === pageId) ??
    file.pages.find((page) => page.id === file.defaultPageId) ??
    orderedCanvasPages(file)[0];
  if (!page) throw new Error("CanvasFile must contain at least one Page");
  return page;
}
