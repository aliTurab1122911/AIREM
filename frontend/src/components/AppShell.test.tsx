import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { AppShell } from "./AppShell";

vi.mock("../lib/api", () => ({ api: { logout: vi.fn() } }));

function renderShell() {
  render(
    <MemoryRouter initialEntries={["/app"]}>
      <Routes>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<div>Account home</div>} />
        </Route>
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppShell logout", () => {
  afterEach(() => vi.clearAllMocks());

  it("navigates to login after logout succeeds", async () => {
    vi.mocked(api.logout).mockResolvedValue(undefined);
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  it("shows an error and remains signed in when logout fails", async () => {
    vi.mocked(api.logout).mockRejectedValue(new Error("CSRF rejected"));
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Log out failed. Please try again.",
    );
    await waitFor(() => expect(api.logout).toHaveBeenCalledOnce());
    expect(screen.getByText("Account home")).toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });
});
