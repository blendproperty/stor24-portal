"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { canVisit, type NavigationAccess } from "@/lib/navigation-access";

type Destination = { href: string; label: string; group: string };

export function WorkspaceFinder({ items, access }: { items: Destination[]; access: NavigationAccess }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const results = items.filter(item => canVisit(item.href, access) && query.toLowerCase().trim().split(/\s+/).every(word => `${item.label} ${item.group}`.toLowerCase().includes(word)));
  function open() {
    if (document.querySelector('dialog[open], [role="dialog"]')) return;
    setQuery("");
    dialog.current?.showModal();
    input.current?.focus();
  }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!document.querySelector('dialog[open], [role="dialog"]')) {
          setQuery("");
          dialog.current?.showModal();
          input.current?.focus();
        }
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  return <>
    <button ref={trigger} className="workspace-finder-trigger" type="button" onClick={open} aria-label="Find a workspace" aria-haspopup="dialog"><Search size={17} /><span>Find a workspace</span><kbd>Ctrl K</kbd></button>
    <dialog ref={dialog} className="workspace-finder" aria-labelledby="workspace-finder-title" onClose={() => trigger.current?.focus()}>
      <div className="workspace-finder-heading"><div><p className="eyebrow">Go directly to your next task</p><h2 id="workspace-finder-title">Find a workspace</h2></div><button className="icon-button" type="button" aria-label="Close workspace finder" onClick={() => dialog.current?.close()}><X size={18}/></button></div>
      <label className="workspace-finder-search"><Search size={18}/><input ref={input} aria-label="Search workspaces" placeholder="Try customer, move-in, payments or reports" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <p className="workspace-finder-count" role="status">{results.length} {results.length === 1 ? "workspace" : "workspaces"} available to your role</p>
      <nav aria-label="Workspace search results" className="workspace-finder-results">{results.map(item => <Link key={item.href} href={item.href} onClick={() => dialog.current?.close()}><span><strong>{item.label}</strong><small>{item.group}</small></span><ArrowUpRight size={17}/></Link>)}{!results.length && <div className="empty-state"><strong>No matching workspace</strong><p>Try a shorter name, or ask your administrator about access.</p></div>}</nav>
      <footer>Search for a screen here. Use each workspace’s filters to find customer and unit records.</footer>
    </dialog>
  </>;
}
