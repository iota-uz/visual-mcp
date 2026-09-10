import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useRevisionEditor } from "./useRevisionEditor";

describe("versioned draft editing", () => {
  test("keeps acknowledged document while an old subscription is still arriving", async () => {
    const write = vi.fn().mockResolvedValue("r2");
    const { result, rerender } = renderHook(
      ({ revision, text }) => useRevisionEditor({ revision, document: { text } }, write),
      { initialProps: { revision: "r1", text: "old" } },
    );
    act(() => result.current.edit({ text: "new" }));
    await act(() => result.current.save());
    rerender({ revision: "r1", text: "old" });
    expect(result.current.document.text).toBe("new");
    rerender({ revision: "r2", text: "new" });
    rerender({ revision: "r3", text: "agent update" });
    await waitFor(() => expect(result.current.document.text).toBe("agent update"));
  });

  test("retains edits on CAS conflict and shows the real saved snapshot", async () => {
    const write = vi.fn().mockRejectedValue({ data: { code: "REVISION_CONFLICT" } });
    const { result, rerender } = renderHook(
      ({ text }) => useRevisionEditor({ revision: text, document: { text } }, write),
      { initialProps: { text: "old" } },
    );
    act(() => result.current.edit({ text: "my narration" }));
    rerender({ text: "agent narration" });
    await act(() => result.current.save());
    expect(result.current.state).toBe("conflict");
    expect(result.current.document.text).toBe("my narration");
    expect(result.current.savedDocument.text).toBe("agent narration");
    act(() => result.current.useSaved());
    expect(result.current.document.text).toBe("agent narration");
  });

  test("retries an unconfirmed write with identical payload and key", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValue("r2");
    const { result } = renderHook(() =>
      useRevisionEditor({ revision: "r1", document: { text: "old" } }, write),
    );
    act(() => result.current.edit({ text: "new" }));
    await act(() => result.current.save());
    expect(result.current.state).toBe("error");
    act(() => result.current.edit({ text: "do not change pending payload" }));
    await act(() => result.current.save());
    expect(write.mock.calls[0]).toEqual(write.mock.calls[1]);
    expect(result.current.document.text).toBe("new");
  });

  test("validation rejection allows correction without automatic retry loop", async () => {
    const write = vi.fn().mockRejectedValue({ data: { code: "VALIDATION_ERROR" } });
    const { result } = renderHook(() =>
      useRevisionEditor({ revision: "r1", document: { text: "old" } }, write),
    );
    act(() => result.current.edit({ text: "invalid" }));
    await act(() => result.current.save());
    expect(result.current.state).toBe("invalid");
    expect(result.current.locked).toBe(false);
    act(() => result.current.edit({ text: "corrected" }));
    expect(result.current.document.text).toBe("corrected");
  });
});
