"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Dialog } from "./overlays";

export type CommandItem = {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  shortcut?: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
};

export type CommandSurfaceProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: CommandItem[];
  title?: string;
  placeholder?: string;
  emptyMessage?: string;
};

export function CommandSurface({ open, onOpenChange, commands, title = "Commands", placeholder = "Search commands", emptyMessage = "No matching commands", }: CommandSurfaceProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return commands;
    return commands.filter((item) => [item.label, item.description ?? "", ...(item.keywords ?? [])].some((text) => text.toLocaleLowerCase().includes(term)));
  }, [commands, query]);
  const enabled = filtered.filter((item) => !item.disabled);

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const selectCommand = (item: CommandItem) => {
    item.onSelect();
    setQuery("");
    onOpenChange(false);
  };

  const moveFocus = (currentId: string, direction: 1 | -1) => {
    const currentIndex = enabled.findIndex((item) => item.id === currentId);
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0) { inputRef.current?.focus(); return; }
    const next = enabled[nextIndex % enabled.length];
    if (next) itemRefs.current.get(next.id)?.focus();
  };

  const handleItemKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(id, 1); }
    if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(id, -1); }
    if (event.key === "Home") { event.preventDefault(); inputRef.current?.focus(); }
    if (event.key === "End") { event.preventDefault(); const last = enabled.at(-1); if (last) itemRefs.current.get(last.id)?.focus(); }
  };

  return <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) setQuery(""); onOpenChange(nextOpen); }} title={title} contentClassName="nn-command">
    <input ref={inputRef} className="nn-command__input" type="search" aria-label="Search commands" placeholder={placeholder} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
      if (event.key === "ArrowDown") { const first = enabled[0]; if (first) { event.preventDefault(); itemRefs.current.get(first.id)?.focus(); } }
      if (event.key === "Enter") { const first = enabled[0]; if (first) { event.preventDefault(); selectCommand(first); } }
    }} />
    <div className="nn-command__results" role="group" aria-label="Available commands">
      {filtered.length ? filtered.map((item) => <button key={item.id} ref={(node) => { if (node) itemRefs.current.set(item.id, node); else itemRefs.current.delete(item.id); }} type="button" className="nn-command__item" disabled={item.disabled} onKeyDown={(event) => handleItemKeyDown(event, item.id)} onClick={() => selectCommand(item)}>
        {item.icon && <span className="nn-command__icon" aria-hidden="true">{item.icon}</span>}
        <span className="nn-command__copy"><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span>
        {item.shortcut && <kbd>{item.shortcut}</kbd>}
      </button>) : <p className="nn-command__empty">{emptyMessage}</p>}
    </div>
  </Dialog>;
}
