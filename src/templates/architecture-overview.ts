/**
 * architecture-overview template (PLAN.md section 10, worked example 3.2).
 *
 * D2 source describing a realistic system architecture: client tier, API
 * gateway, core services, data stores and an async worker/queue. Rendered
 * via the D2 wrapper (src/render/diagrams) to SVG, then either exported
 * standalone or embedded inline into an HTML report (PLAN.md section 15).
 */

import type { Template } from "../types.js";

const exampleCode = `# Architecture overview: Insurance CRM platform
# Render with the D2 wrapper -> SVG, embed inline into HTML reports or
# export standalone (PLAN.md section 3.2 / 8.3).

direction: down

Web App: {
  shape: rectangle
}
Mobile App: {
  shape: rectangle
}

API Gateway: {
  shape: rectangle
}

CRM Core: {
  shape: rectangle
}
Billing Service: {
  shape: rectangle
}
Notification Worker: {
  shape: rectangle
}

Postgres: {
  shape: cylinder
}
Redis: {
  shape: cylinder
}
Message Queue: {
  shape: queue
}

Web App -> API Gateway: HTTPS
Mobile App -> API Gateway: HTTPS

API Gateway -> CRM Core: REST
API Gateway -> Billing Service: REST

CRM Core -> Postgres: SQL
CRM Core -> Redis: cache
CRM Core -> Message Queue: publish events

Billing Service -> Postgres: SQL
Billing Service -> Message Queue: publish invoices

Message Queue -> Notification Worker: consume
Notification Worker -> Postgres: write delivery log
`;

export const architectureOverviewTemplate: Template = {
  id: "architecture-overview",
  name: "Architecture Overview",
  kind: "diagram",
  description:
    "System architecture diagram (D2) showing client apps, API gateway, " +
    "core services, data stores and an async worker/queue. Good default " +
    "for onboarding docs, RFCs and report 'System Architecture' pages.",
  expectedInputs: {
    title: "string — diagram title, e.g. 'Insurance CRM Platform'",
    nodes: [
      {
        name: "string — node label, e.g. 'API Gateway'",
        shape:
          "string — D2 shape keyword, e.g. 'rectangle' | 'cylinder' | 'queue'",
      },
    ],
    edges: [
      {
        from: "string — source node name",
        to: "string — target node name",
        label: "string — edge label, e.g. 'REST' | 'SQL' | 'publish events'",
      },
    ],
    direction: "'up' | 'down' | 'left' | 'right' — D2 layout direction",
  },
  exampleCode,
};
