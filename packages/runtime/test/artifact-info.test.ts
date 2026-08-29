import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { inferArtifactInfo } from "../src/render/artifact-info.js";

describe("artifact MIME inference", () => {
  const cases = [
    ["/assets/photo.avif", "image/avif"],
    ["/assets/demo.mp4", "video/mp4"],
    ["/assets/demo.webm", "video/webm"],
    ["/assets/type.woff2", "font/woff2"],
    ["/assets/type.woff", "font/woff"],
    ["/assets/type.ttf", "font/ttf"],
    ["/assets/type.otf", "font/otf"],
  ] as const;
  for (const [path, mime] of cases) {
    test(`recognizes ${path}`, () => {
      assert.equal(inferArtifactInfo(path).mime, mime);
    });
  }
});
