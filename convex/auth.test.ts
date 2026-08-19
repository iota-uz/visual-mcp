/**
 * Pins the one thing that keeps sign-in-without-Google out of production.
 *
 * This project's live deployment is the *dev* deployment, so there is no
 * build-time flag that can tell the two apart — the only gate is that
 * `DEV_AUTH_SECRET` is set on the local backend and on nothing else. If
 * that gate ever stops working, every @iota.uz-shaped email would be able
 * to sign in to the real app with a shared string. Hence a test.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_PROVIDER_ID, devAuthSecret } from "./lib/devAuth";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the dev sign-in provider", () => {
  it("is absent when DEV_AUTH_SECRET is unset", async () => {
    vi.stubEnv("DEV_AUTH_SECRET", "");
    vi.resetModules();
    const { devProviders } = await import("./auth");
    expect(devProviders).toHaveLength(0);
  });

  it("is present when DEV_AUTH_SECRET is set", async () => {
    vi.stubEnv("DEV_AUTH_SECRET", "local-only-secret");
    vi.resetModules();
    const { devProviders } = await import("./auth");
    expect(devProviders).toHaveLength(1);
    expect(devProviders[0].id).toBe(DEV_PROVIDER_ID);
  });

  it("treats an empty string as unset", () => {
    vi.stubEnv("DEV_AUTH_SECRET", "");
    expect(devAuthSecret()).toBeUndefined();
  });
});
