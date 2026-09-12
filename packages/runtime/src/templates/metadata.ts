import type { Template, TemplateId } from "../types.js";

type Metadata = Pick<
  Template,
  | "useWhen"
  | "avoidWhen"
  | "supportedViewports"
  | "requiredStates"
  | "designCharacteristics"
  | "preview"
  | "compatibleThemes"
>;

const allThemes = ["clean-saas", "minimal-docs", "dark-terminal", "startup-pitch"] as const;
const desktop = [{ label: "desktop", width: 1280, height: 800 }];
const mobile = [
  { label: "mobile", width: 390, height: 844 },
  { label: "wide-mobile", width: 430, height: 932 },
];

const entries: Record<TemplateId, Omit<Metadata, "compatibleThemes">> = {
  "architecture-overview": {
    useWhen: ["Explaining system boundaries, services, and dependencies"],
    avoidWhen: ["The request is primarily temporal or step-by-step"],
    supportedViewports: [{ label: "landscape", width: 1440, height: 900 }],
    requiredStates: ["normal", "dependency-risk"],
    designCharacteristics: ["layered hierarchy", "labeled relationships", "bounded clusters"],
    preview: { viewport: { width: 1440, height: 900 }, format: "d2" },
  },
  "sequence-flow": {
    useWhen: ["Showing ordered messages between actors or services"],
    avoidWhen: ["Spatial architecture is more important than chronology"],
    supportedViewports: [{ label: "landscape", width: 1440, height: 900 }],
    requiredStates: ["happy-path", "failure-path"],
    designCharacteristics: ["clear actor lanes", "ordered messages", "explicit failure branch"],
    preview: { viewport: { width: 1440, height: 900 }, format: "d2" },
  },
  "mobile-app-screen": {
    useWhen: ["Designing a content-first mobile product screen"],
    avoidWhen: ["Device chrome must be authored inside the HTML"],
    supportedViewports: mobile,
    requiredStates: ["default", "loading", "empty", "error"],
    designCharacteristics: ["single primary action", "touch targets", "content hierarchy"],
    preview: { viewport: { width: 390, height: 844 }, format: "html" },
  },
  "phone-frame-screen": {
    useWhen: ["Placing mobile content in CanvasDoc phone chrome"],
    avoidWhen: ["The iframe already draws a handset shell"],
    supportedViewports: [{ label: "phone-content", width: 284, height: 642 }],
    requiredStates: ["default", "loading", "error"],
    designCharacteristics: ["content-only", "safe-area aware", "touch-first"],
    preview: { viewport: { width: 284, height: 642 }, format: "html" },
  },
  "device-frame-screen": {
    useWhen: ["Previewing responsive content in a named device preset"],
    avoidWhen: ["A plain browser or frameless surface is requested"],
    supportedViewports: [{ label: "mobile-preset-content", width: 284, height: 590 }],
    requiredStates: ["default", "loading", "error"],
    designCharacteristics: ["content-only", "responsive", "no duplicate chrome"],
    preview: { viewport: { width: 284, height: 590 }, format: "html" },
  },
  "browser-app-screen": {
    useWhen: ["Designing a desktop web application surface"],
    avoidWhen: ["The deliverable is a data report or mobile flow"],
    supportedViewports: desktop,
    requiredStates: ["default", "loading", "empty", "error"],
    designCharacteristics: ["clear navigation", "dense but scannable", "desktop hierarchy"],
    preview: { viewport: { width: 1280, height: 800 }, format: "html" },
  },
  "dashboard-overview": {
    useWhen: ["Summarizing KPIs, trends, and operational drivers"],
    avoidWhen: ["The evidence needs a paginated narrative"],
    supportedViewports: desktop,
    requiredStates: ["populated", "loading", "empty", "error"],
    designCharacteristics: ["answer-first KPIs", "semantic chart palette", "ranked detail"],
    preview: { viewport: { width: 1280, height: 800 }, format: "html" },
  },
  "one-page-infographic": {
    useWhen: ["Communicating one memorable argument on a single page"],
    avoidWhen: ["Dense tables or detailed methods are required"],
    supportedViewports: [{ label: "portrait", width: 900, height: 1200 }],
    requiredStates: ["complete"],
    designCharacteristics: ["strong headline", "few proof points", "visual rhythm"],
    preview: { viewport: { width: 900, height: 1200 }, format: "html" },
  },
  "multipage-report": {
    useWhen: ["Delivering a durable narrative with sections and evidence"],
    avoidWhen: ["A live monitoring dashboard is requested"],
    supportedViewports: [{ label: "a4", width: 794, height: 1123 }],
    requiredStates: ["cover", "body", "appendix"],
    designCharacteristics: ["print-safe", "page hierarchy", "repeatable sections"],
    preview: { viewport: { width: 794, height: 1123 }, format: "html" },
  },
  "chart-report": {
    useWhen: ["Quantitative findings need charts plus concise interpretation"],
    avoidWhen: ["No trustworthy numeric evidence is available"],
    supportedViewports: desktop,
    requiredStates: ["populated", "no-data", "error"],
    designCharacteristics: ["semantic chart palette", "labeled axes", "takeaway text"],
    preview: { viewport: { width: 1280, height: 800 }, format: "html" },
  },
  "iframe-service-flow": {
    useWhen: ["Showing a service flow as an interactive HTML screen"],
    avoidWhen: ["A pure D2 architecture diagram is enough"],
    supportedViewports: desktop,
    requiredStates: ["normal", "failure"],
    designCharacteristics: ["ordered flow", "service ownership", "explicit status"],
    preview: { viewport: { width: 1280, height: 800 }, format: "tool-call" },
  },
  "image-reference-board": {
    useWhen: ["Comparing visual references, assets, or art direction"],
    avoidWhen: ["The task needs a functional product screen"],
    supportedViewports: desktop,
    requiredStates: ["populated", "missing-image"],
    designCharacteristics: ["consistent crops", "source labels", "comparison grid"],
    preview: { viewport: { width: 1280, height: 800 }, format: "tool-call" },
  },
};

export function templateMetadata(id: TemplateId): Metadata {
  return { ...entries[id], compatibleThemes: [...allThemes] };
}
