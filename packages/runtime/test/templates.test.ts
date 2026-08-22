/**
 * Tests for the template registry (src/templates/index.ts), covering
 * PLAN.md section 10's Template contract and section 6.7's
 * list_templates({ kind? }) tool contract.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { getTemplate, listTemplates, TEMPLATES } from "../src/templates/index.js";
import { TEMPLATE_IDS, type TemplateKind } from "../src/types.js";

const KNOWN_KINDS: TemplateKind[] = [
  "canvas",
  "diagram",
  "mockup",
  "report",
  "chart",
  "infographic",
];

test("registry exposes exactly the ids from TEMPLATE_IDS, in order", () => {
  const ids = TEMPLATES.map((t) => t.id);
  assert.deepEqual(ids, [...TEMPLATE_IDS]);
});

test("every template conforms to the Template shape (PLAN.md section 10)", () => {
  for (const template of TEMPLATES) {
    assert.equal(typeof template.id, "string");
    assert.ok(template.id.length > 0, `id must be non-empty for ${template.id}`);

    assert.equal(typeof template.name, "string");
    assert.ok(template.name.length > 0, `name must be non-empty for ${template.id}`);

    assert.ok(
      KNOWN_KINDS.includes(template.kind),
      `kind must be a known TemplateKind for ${template.id}, got ${template.kind}`,
    );

    assert.equal(typeof template.description, "string");
    assert.ok(template.description.length > 0, `description must be non-empty for ${template.id}`);

    assert.equal(typeof template.expectedInputs, "object");
    assert.notEqual(template.expectedInputs, null);
    assert.ok(
      Object.keys(template.expectedInputs).length > 0,
      `expectedInputs must have at least one key for ${template.id}`,
    );

    assert.equal(typeof template.exampleCode, "string");
    assert.ok(
      template.exampleCode.trim().length > 0,
      `exampleCode must be non-empty for ${template.id}`,
    );
  }
});

test("diagram templates contain D2 source, not HTML", () => {
  for (const id of ["architecture-overview", "sequence-flow"] as const) {
    const template = getTemplate(id);
    assert.ok(template, `expected template ${id} to exist`);
    assert.ok(
      !template.exampleCode.includes("<!doctype html>"),
      `${id} exampleCode should be D2 source, not HTML`,
    );
    assert.match(template.exampleCode, /->/);
  }
});

test("sequence-flow uses D2's sequence_diagram shape", () => {
  const template = getTemplate("sequence-flow");
  assert.ok(template);
  assert.match(template.exampleCode, /shape:\s*sequence_diagram/);
});

test("HTML-based templates use Tailwind v4 import, not v3 config", () => {
  const htmlIds = [
    "mobile-app-screen",
    "phone-frame-screen",
    "browser-app-screen",
    "dashboard-overview",
    "one-page-infographic",
    "multipage-report",
    "chart-report",
  ] as const;

  for (const id of htmlIds) {
    const template = getTemplate(id);
    assert.ok(template, `expected template ${id} to exist`);
    assert.match(template.exampleCode, /<!doctype html>/i);
    assert.match(template.exampleCode, /@import "tailwindcss"/);
    assert.doesNotMatch(template.exampleCode, /tailwind\.config\.js/);
  }
});

test("phone-frame-screen is content-only because CanvasDoc owns device chrome", () => {
  const template = getTemplate("phone-frame-screen");
  assert.ok(template);
  assert.match(template.description, /284×642/);
  assert.match(template.description, /canvas supplies/i);
  assert.doesNotMatch(template.exampleCode, /dynamic island|phone-shell|phone-status|bezel/i);
});

test("templates with charts load the local apexcharts bundle, never a CDN", () => {
  const chartIds = ["dashboard-overview", "multipage-report", "chart-report"] as const;

  for (const id of chartIds) {
    const template = getTemplate(id);
    assert.ok(template, `expected template ${id} to exist`);
    assert.match(template.exampleCode, /src="\/assets\/js\/apexcharts\.min\.js"/);
    assert.doesNotMatch(template.exampleCode, /https?:\/\/.*apexcharts/i);
    assert.match(template.exampleCode, /new ApexCharts\(/);
  }
});

test("multipage-report uses break-after: page pagination (PLAN.md section 5)", () => {
  const template = getTemplate("multipage-report");
  assert.ok(template);
  assert.match(template.exampleCode, /break-after:\s*page/);
  // At least 3 page sections: cover, architecture, charts.
  const pageMatches = template.exampleCode.match(/class="page/g) ?? [];
  assert.ok(pageMatches.length >= 3, "expected at least 3 .page sections");
});

test("chart-report includes at least two distinct ApexCharts chart types", () => {
  const template = getTemplate("chart-report");
  assert.ok(template);
  assert.match(template.exampleCode, /type:\s*"bar"/);
  assert.match(template.exampleCode, /type:\s*"line"/);
  assert.match(template.exampleCode, /type:\s*"donut"/);
});

test("listTemplates() with no kind returns all templates", () => {
  const all = listTemplates();
  assert.equal(all.length, TEMPLATE_IDS.length);
});

test("listTemplates(kind) filters correctly for each known kind", () => {
  const expectedByKind: Record<TemplateKind, string[]> = {
    canvas: ["iframe-service-flow", "image-reference-board"],
    diagram: ["architecture-overview", "sequence-flow"],
    mockup: [
      "mobile-app-screen",
      "phone-frame-screen",
      "device-frame-screen",
      "browser-app-screen",
      "dashboard-overview",
    ],
    infographic: ["one-page-infographic"],
    report: ["multipage-report"],
    chart: ["chart-report"],
  };

  for (const kind of KNOWN_KINDS) {
    const filtered = listTemplates(kind);
    assert.deepEqual(
      filtered.map((t) => t.id).sort(),
      [...expectedByKind[kind]].sort(),
      `mismatch for kind=${kind}`,
    );
    for (const template of filtered) {
      assert.equal(template.kind, kind);
    }
  }
});

test("listTemplates(kind) returns a fresh array each call (no external mutation)", () => {
  const a = listTemplates();
  a.pop();
  const b = listTemplates();
  assert.equal(b.length, TEMPLATE_IDS.length);
});

test("getTemplate returns the matching template for every known id", () => {
  for (const id of TEMPLATE_IDS) {
    const template = getTemplate(id);
    assert.ok(template, `expected template ${id} to exist`);
    assert.equal(template.id, id);
  }
});

test("getTemplate returns undefined for an unknown id", () => {
  assert.equal(getTemplate("does-not-exist"), undefined);
  assert.equal(getTemplate(""), undefined);
});
