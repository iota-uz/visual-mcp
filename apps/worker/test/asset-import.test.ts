import assert from "node:assert/strict";
import test from "node:test";
import { isForbiddenImportAddress } from "../src/asset-import.js";

test("asset importer rejects private IPv4 and IPv6 networks", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.1.2",
    "192.168.1.2",
    "169.254.169.254",
    "::1",
    "fd00::1",
    "fe80::1",
  ]) {
    assert.equal(isForbiddenImportAddress(address), true, address);
  }
  assert.equal(isForbiddenImportAddress("1.1.1.1"), false);
  assert.equal(isForbiddenImportAddress("2606:4700:4700::1111"), false);
});
