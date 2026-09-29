// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, IconButton, Input, Select } from "../src";

afterEach(cleanup);

describe("controls", () => {
  it("uses a non-submitting button by default and invokes its action", async () => {
    const action = vi.fn();
    render(<Button onClick={action}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("type")).toBe("button");
    await userEvent.click(button);
    expect(action).toHaveBeenCalledOnce();
  });

  it("requires a spoken label for icon-only buttons", () => {
    render(<IconButton aria-label="Open navigation" icon={<span>≡</span>} />);
    expect(screen.getByRole("button", { name: "Open navigation" })).toBeTruthy();
  });

  it("connects field labels, hints, and errors", () => {
    render(<Input id="name" label="Workspace name" hint="Visible only to you" error="A name is required" />);
    const input = screen.getByRole("textbox", { name: "Workspace name" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("name-hint name-error");
    expect(screen.getByText("A name is required")).toBeTruthy();
  });

  it("generates a valid field association when callers omit id", () => {
    render(<Input label="Search notes" hint="Searches local notes" />);
    const input = screen.getByRole("textbox", { name: "Search notes" });
    const hintId = input.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId ?? "")?.textContent).toBe("Searches local notes");
  });

  it("preserves native select keyboard behavior", async () => {
    render(<Select id="theme" label="Theme" defaultValue="light"><option value="light">Light</option><option value="dark">Dark</option></Select>);
    const select = screen.getByRole("combobox", { name: "Theme" }) as HTMLSelectElement;
    await userEvent.selectOptions(select, "dark");
    expect(select.value).toBe("dark");
  });
});
