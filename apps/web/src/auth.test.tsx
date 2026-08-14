import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { clearSignInAttempt, SignInButton } from "./auth";

const { signInMock, useQueryMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: signInMock, signOut: vi.fn() }),
}));
vi.mock("convex/react", () => ({ useQuery: useQueryMock }));

/*
 * The org rejection never comes back as an error the client can catch: the
 * Convex Auth callback logs it and issues a bare redirect. These tests pin
 * the reconstruction — a sign-in that started and did not finish must say
 * so, and one that never started must not.
 */
describe("SignInButton", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    signInMock.mockReset();
    // Never resolves: the real one navigates away instead of returning.
    signInMock.mockReturnValue(new Promise(() => {}));
  });

  test("says nothing on a first visit", () => {
    render(<SignInButton />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("explains the bounce when a sign-in was in flight and no session came back", async () => {
    await userEvent.click(render(<SignInButton />).getByRole("button"));
    // The redirect Google would have performed, and the trip back.
    render(<SignInButton />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/@iota\.uz/);
  });

  test("does not repeat the message on the next mount", async () => {
    await userEvent.click(render(<SignInButton />).getByRole("button"));
    render(<SignInButton />).unmount();
    render(<SignInButton />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a completed sign-in clears the marker, so signing out lands on a clean wall", async () => {
    await userEvent.click(render(<SignInButton />).getByRole("button"));
    clearSignInAttempt(); // what App.tsx calls once a session exists
    render(<SignInButton />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
