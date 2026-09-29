// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandSurface, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from "../src";

afterEach(cleanup);

describe("keyboard overlays", () => {
  it("moves tab selection with arrow keys", async () => {
    render(<Tabs defaultValue="notes"><TabsList aria-label="Workspace views"><TabsTrigger value="notes">Notes</TabsTrigger><TabsTrigger value="tasks">Tasks</TabsTrigger></TabsList><TabsContent value="notes">Note list</TabsContent><TabsContent value="tasks">Task list</TabsContent></Tabs>);
    const notes = screen.getByRole("tab", { name: "Notes" });
    notes.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Tasks" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Tasks" }).textContent).toBe("Task list");
  });

  it("closes a dialog on Escape and returns focus to its trigger", async () => {
    render(<Dialog title="About Noor Note" trigger={<button type="button">Open About</button>}><p>Your notes belong to you.</p></Dialog>);
    const trigger = screen.getByRole("button", { name: "Open About" });
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "About Noor Note" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("opens a menu from the keyboard and activates an item", async () => {
    const action = vi.fn();
    render(<DropdownMenu><DropdownMenuTrigger>Actions</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={action}>Rename</DropdownMenuItem></DropdownMenuContent></DropdownMenu>);
    screen.getByRole("button", { name: "Actions" }).focus();
    await userEvent.keyboard("{Enter}");
    const item = await screen.findByRole("menuitem", { name: "Rename" });
    expect(document.activeElement).toBe(item);
    await userEvent.keyboard("{Enter}");
    expect(action).toHaveBeenCalledOnce();
  });

  it("filters commands and activates the focused result with Enter", async () => {
    const create = vi.fn();
    const exportNotes = vi.fn();
    const onOpenChange = vi.fn();
    render(<CommandSurface open onOpenChange={onOpenChange} commands={[{ id: "create", label: "Create note", onSelect: create }, { id: "export", label: "Export backup", keywords: ["download"], onSelect: exportNotes }]} />);
    const search = screen.getByRole("searchbox", { name: "Search commands" });
    await userEvent.type(search, "download");
    expect(screen.queryByRole("button", { name: "Create note" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export backup" })).toBeTruthy();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(exportNotes).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("runs the first available command from the search field", async () => {
    const disabledAction = vi.fn();
    const action = vi.fn();
    render(<CommandSurface open onOpenChange={() => undefined} commands={[{ id: "disabled", label: "Disabled", disabled: true, onSelect: disabledAction }, { id: "ready", label: "Ready", onSelect: action }]} />);
    screen.getByRole("searchbox", { name: "Search commands" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(action).toHaveBeenCalledOnce();
    expect(disabledAction).not.toHaveBeenCalled();
  });
});
