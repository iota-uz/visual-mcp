import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useDurableJobIntent } from "./useDurableJobIntent";

const identity = vi.hoisted(() => ({ userId: "first" }));
vi.mock("../../auth", () => ({ useSessionUser: () => identity }));
beforeEach(() => {
  localStorage.clear();
  identity.userId = "first";
});
test("shot intent survives reload without crossing accounts or changing the request", async () => {
  const intent = {
    idempotencyKey: "same-paid-key",
    request: {
      kind: "shot",
      allowPaid: true,
      draftId: "draft",
      sceneId: "scene",
      shotId: "shot",
      scriptRevision: "r1",
      startImage: { assetId: "asset", revisionId: "v1" },
      profileId: "higgsfield-kling-v2.5-turbo-pro",
      prompt: "Move",
      durationMs: 5000,
    },
  };
  const first = renderHook(() =>
    useDurableJobIntent<typeof intent>("shot:workspace:draft:scene:shot"),
  );
  await waitFor(() => expect(first.result.current.ready).toBe(true));
  act(() => first.result.current.save(intent));
  first.unmount();
  const restored = renderHook(() =>
    useDurableJobIntent<typeof intent>("shot:workspace:draft:scene:shot"),
  );
  await waitFor(() => expect(restored.result.current.current).toEqual(intent));
  identity.userId = "second";
  restored.rerender();
  await waitFor(() => expect(restored.result.current.ready).toBe(true));
  expect(restored.result.current.current).toBeNull();
  identity.userId = "first";
  restored.rerender();
  await waitFor(() => expect(restored.result.current.current).toEqual(intent));
});
