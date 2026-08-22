import assert from "node:assert/strict";
import { test } from "node:test";
import { renderAnnotation, sanitizeAnnotationHtml } from "../src/annotation.js";

test("text annotations are rendered literally", () => {
  assert.equal(
    renderAnnotation({ format: "text", content: '<b onclick="alert(1)">literal</b>' }),
    '<p>&lt;b onclick=&quot;alert(1)&quot;&gt;literal&lt;/b&gt;</p>',
  );
});

test("HTML annotations preserve the documented safe subset", () => {
  assert.equal(
    sanitizeAnnotationHtml(
      '<p><strong>Ready</strong> <a href="https://example.com" title="Details">open</a></p>',
    ),
    '<p><strong>Ready</strong> <a href="https://example.com" rel="noopener noreferrer" title="Details">open</a></p>',
  );
});

test("HTML annotations remove scripts, handlers, styles, and unsafe URLs", () => {
  const rendered = sanitizeAnnotationHtml(
    '<script>alert(1)</script><p style="color:red" onclick="alert(2)">Safe</p><a href="javascript:alert(3)" onmouseover="alert(4)">link</a><img src=x onerror=alert(5)>',
  );
  assert.equal(rendered, 'alert(1)<p>Safe</p><a>link</a>');
  assert.doesNotMatch(rendered, /script|onclick|onmouseover|onerror|javascript:|style=|<img/i);
});

test("empty annotations render no panel content", () => {
  assert.equal(renderAnnotation(undefined), "");
});
