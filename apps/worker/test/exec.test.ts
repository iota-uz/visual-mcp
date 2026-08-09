/**
 * Tests for the worker's /exec logic (src/exec.ts): run_code against a
 * hydrated throwaway workspace, with produced /output files uploaded
 * through the anonymous upload-slot pool (see schemas.ts's doc comment).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { handleExec } from "../src/exec.js";
import { startTestUploadServer } from "./test-upload-server.js";

test("handleExec: runs code and reports stdout", async () => {
  const uploadServer = await startTestUploadServer();
  try {
    const result = await handleExec({
      sources: [],
      code: 'console.log("hello from sandbox");',
      uploads: [],
    });
    assert.equal(result.success, true);
    assert.match(result.stdout, /hello from sandbox/);
    assert.equal(result.artifacts.length, 0);
  } finally {
    await uploadServer.close();
  }
});

test("handleExec: uploads a file the code wrote to /output", async () => {
  const uploadServer = await startTestUploadServer();
  try {
    const result = await handleExec({
      sources: [],
      code: 'fs.writeFileSync("/output/hello.txt", "hi there");',
      uploads: [{ putUrl: uploadServer.putUrl("out-1") }],
    });

    assert.equal(result.success, true);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]?.relPath, "/output/hello.txt");
    assert.equal(result.artifacts[0]?.uploaded, true);
    assert.equal(result.artifacts[0]?.uploadStatus, 200);
    assert.equal(uploadServer.uploads.length, 1);
    assert.equal(uploadServer.uploads[0]?.bytes.toString("utf8"), "hi there");
  } finally {
    await uploadServer.close();
  }
});

test("handleExec: reports an extra output as not uploaded when the pool runs out", async () => {
  const uploadServer = await startTestUploadServer();
  try {
    const result = await handleExec({
      sources: [],
      code: `
        fs.writeFileSync("/output/a.txt", "a");
        fs.writeFileSync("/output/b.txt", "b");
      `,
      uploads: [{ putUrl: uploadServer.putUrl("only-slot") }],
    });

    assert.equal(result.artifacts.length, 2);
    const uploaded = result.artifacts.filter((a) => a.uploaded);
    const skipped = result.artifacts.filter((a) => !a.uploaded);
    assert.equal(uploaded.length, 1);
    assert.equal(skipped.length, 1);
  } finally {
    await uploadServer.close();
  }
});

test("handleExec: reports a runtime error without throwing", async () => {
  const uploadServer = await startTestUploadServer();
  try {
    const result = await handleExec({
      sources: [],
      code: "throw new Error('boom');",
      uploads: [],
    });
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /boom/);
  } finally {
    await uploadServer.close();
  }
});
