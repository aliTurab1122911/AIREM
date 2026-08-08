import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Auth } from "./Auth";
import { PASSWORD_MIN_LENGTH, registrationSchema } from "@airem/contracts";

afterEach(() => vi.restoreAllMocks());

describe("authentication forms", () => {
  it("uses the server registration password constraint and matching guidance", () => {
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Auth />
      </MemoryRouter>,
    );

    const password = screen.getByLabelText(/Password/);
    expect(password).toHaveAttribute("minlength", String(PASSWORD_MIN_LENGTH));
    expect(password).toHaveAttribute(
      "placeholder",
      `At least ${PASSWORD_MIN_LENGTH} characters`,
    );
    expect(
      registrationSchema.safeParse({
        displayName: "Alex Morgan",
        email: "alex@example.test",
        password: "x".repeat(PASSWORD_MIN_LENGTH - 1),
      }).success,
    ).toBe(false);
    expect(
      registrationSchema.safeParse({
        displayName: "Alex Morgan",
        email: "alex@example.test",
        password: "x".repeat(PASSWORD_MIN_LENGTH),
      }).success,
    ).toBe(true);
  });

  it("reports an invalid login accessibly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 401 }),
    );
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Auth />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.test" },
    });
    fireEvent.change(screen.getByLabelText(/Password/), {
      target: { value: "not-the-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "couldn’t complete",
    );
  });

  it("shows the privacy-preserving reset confirmation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"ok":true}', { status: 200 }),
    );
    render(
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <Auth />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "If an account exists",
      ),
    );
  });
});
