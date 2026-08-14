import { CanvasDocSchema } from "../src/types.js";

const DOT_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#eef4ff"/><circle cx="100" cy="60" r="34" fill="#2f6df6"/></svg>',
  );

const doc = {
  version: 1 as const,
  title: "OSAGO fast settlement (B1 fixture)",
  subtitle: "One node per shape, one lane per role, mixed edge routes — exercises the full engine.",
  grid: { stageWidth: 1160, startX: 120 },
  lanes: [
    { id: "actors", label: "Actors", role: "actors", height: 260 },
    { id: "primary", label: "Culprit — EAI app", role: "primary", height: 700 },
    { id: "secondary", label: "Victim — eai.uz", role: "secondary", height: 700 },
    { id: "automation", label: "AI / algorithms", role: "automation", height: 240 },
    { id: "exception", label: "Exceptions & support", role: "exception", height: 420 },
    { id: "support", label: "Support console", role: "support", height: 280 },
    { id: "system", label: "Granite", role: "system", height: 420 },
    { id: "external", label: "External registry (ERSP)", role: "external", height: 260 },
  ],
  stages: [
    { id: "report", index: 0, label: "1. Report", summary: "Culprit files a claim" },
    { id: "verify", index: 1, label: "2. Verify", summary: "Automated checks run" },
    { id: "settle", index: 2, label: "3. Settle", summary: "Payout decision" },
    { id: "close", index: 3, label: "4. Close", summary: "Case archived" },
  ],
  legend: [
    {
      title: "Roles",
      items: [
        { label: "Culprit", role: "primary" },
        { label: "Victim", role: "secondary" },
        { label: "Granite", role: "system" },
        { label: "External", role: "external" },
      ],
    },
    {
      title: "Maturity",
      items: [
        { label: "Live in Granite", tone: "live" },
        { label: "Partial", tone: "partial" },
        { label: "Planned", tone: "planned" },
      ],
    },
  ],
  nodes: [
    {
      id: "culprit-actor",
      lane: "actors",
      stage: "report",
      shape: "actor",
      caption: { title: "Culprit", subtitle: "Files claim from phone" },
      inspector: {
        eyebrow: "Actor",
        title: "Culprit",
        copy: "The at-fault driver opens the EAI app right after the accident.",
        points: ["Authenticates via eID", "Photographs the scene", "Submits initial statement"],
      },
    },
    {
      id: "culprit-screen",
      lane: "primary",
      stage: "report",
      shape: "screen",
      badge: { text: "LIVE", tone: "live" },
      caption: { title: "Report accident", subtitle: "EAI mobile", tag: "APP" },
      content: {
        type: "html",
        frame: "phone",
        html: '<div style="padding:16px;font:600 12px/1.4 sans-serif;color:#18314d">Where did it happen?<br/><br/><button style="padding:8px 12px;border-radius:8px;background:#2f6df6;color:#fff;border:none">Continue</button></div>',
      },
    },
    {
      id: "victim-screen",
      lane: "secondary",
      stage: "verify",
      shape: "window",
      badge: { text: "PARTIAL", tone: "partial" },
      caption: { title: "Confirm details", subtitle: "eai.uz web", tag: "WEB" },
      content: {
        type: "html",
        html: `<img src="${DOT_SVG}" alt="" style="width:100%;height:100%;object-fit:contain" />`,
      },
    },
    {
      id: "risk-model",
      lane: "automation",
      stage: "verify",
      shape: "automation",
      caption: { title: "Risk scoring model", tag: "AI" },
      inspector: {
        eyebrow: "Automation",
        title: "Risk scoring model",
        copy: "Scores the claim against known fraud patterns before it reaches an adjuster.",
      },
    },
    {
      id: "fraud-check",
      lane: "automation",
      stage: "settle",
      shape: "decision",
      caption: { title: "Fraud signal?" },
    },
    {
      id: "manual-review",
      lane: "exception",
      stage: "settle",
      shape: "note",
      badge: { text: "PLANNED", tone: "planned" },
      caption: { title: "Manual review queue", subtitle: "Escalated cases only" },
      content: { type: "text", body: "Adjuster reviews flagged claims within 1 business day." },
    },
    {
      id: "support-console",
      lane: "support",
      stage: "settle",
      shape: "window",
      caption: { title: "Support console", subtitle: "Internal", tag: "OPS" },
      content: { type: "text", body: "Case timeline, documents, and payout controls." },
    },
    {
      id: "granite-case",
      lane: "system",
      stage: "close",
      shape: "service",
      badge: { text: "LIVE", tone: "live" },
      caption: { title: "Granite case record" },
      inspector: {
        eyebrow: "System of record",
        title: "Granite case record",
        copy: "The case's final state lives here — everything upstream is provisional until this write lands.",
      },
    },
    {
      id: "ersp-registry",
      lane: "external",
      stage: "close",
      shape: "registry",
      caption: { title: "ERSP registry", subtitle: "National insurance DB" },
    },
  ],
  edges: [
    { from: "culprit-actor", to: "culprit-screen", kind: "actor", label: "opens app" },
    { from: "culprit-screen", to: "victim-screen", kind: "sync", label: "notifies" },
    { from: "victim-screen", to: "risk-model", kind: "main", label: "submits" },
    { from: "risk-model", to: "fraud-check", kind: "main" },
    {
      from: "fraud-check",
      to: "manual-review",
      kind: "exception",
      label: "flagged",
      route: "vertical",
    },
    { from: "manual-review", to: "support-console", kind: "exception", label: "escalates" },
    {
      from: "fraud-check",
      to: "granite-case",
      kind: "main",
      label: "clean → settle",
    },
    {
      from: "support-console",
      to: "granite-case",
      kind: "sync",
      label: "resolution ↔ record",
      bidirectional: true,
    },
    { from: "granite-case", to: "ersp-registry", kind: "external", label: "publish" },
    {
      from: "culprit-screen",
      to: "granite-case",
      kind: "secondary",
      label: "audit trail",
      route: "gutter",
    },
  ],
};

export const fixtureDoc = CanvasDocSchema.parse(doc);
