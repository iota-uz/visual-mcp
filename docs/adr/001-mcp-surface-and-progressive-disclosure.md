# ADR 001: MCP surface and progressive disclosure

Status: accepted

The server keeps task-shaped tools because atomic canvas, page, node, component, comment, and asset operations have materially different validation, side effects, retry behavior, and concurrency guards. Collapsing them into a generic execute tool would hide those contracts from routing models and weaken authorization and observability.

Every tool description therefore declares when to use it, when not to use it, the narrower operation to prefer, side effects, retry behavior, and error expectations. Shared operating guidance stays in server instructions. Large authoring guidance, themes, and examples are MCP resources loaded only when selected: compact catalogs route first, then a caller reads one guide/theme/template and its preview. Template source is never included in the catalog.

The surface is accepted when the versioned routing set reaches at least 90% recall and 95% negative precision. Surface additions require a distinct atomic contract and new positive/negative routing cases; otherwise extend an existing schema or resource.
