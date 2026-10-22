"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { canVisit, type NavigationAccess } from "@/lib/navigation-access";
import { filterGuides, taskSearchText, type WorkflowGuide } from "@/lib/guided-help-state";

export type Destination = { href: string; label: string; group: string };

export function WorkspaceFinder({ items, access, guides, loading, loadFailed, onOpen, onClose, onGuide }: { items: Destination[]; access: NavigationAccess; guides: WorkflowGuide[]; loading: boolean; loadFailed: boolean; onOpen: () => void; onClose: () => void; onGuide: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const openingGuide = useRef(false);
  const [query, setQuery] = useState("");
  const results = items.filter(item => canVisit(item.href, access) && taskSearchText(query).split(/\s+/).every(word => taskSearchText(`${item.label} ${item.group} ${item.href}`).includes(word)));
  const tasks = filterGuides(query, "All", guides);
  function open() {
    if (document.querySelector('dialog[open], [role="dialog"]')) return;
    setQuery("");
    openingGuide.current = false;
    onOpen();
    dialog.current?.showModal();
    input.current?.focus();
  }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!document.querySelector('dialog[open], [role="dialog"]')) {
          trigger.current?.click();
        }
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  return <>
    <button ref={trigger} className="workspace-finder-trigger" type="button" onClick={open} aria-label="Find a workspace" title="Search tasks and pages (Ctrl K)" aria-haspopup="dialog"><Search size={17} /><span>What do you want to do?</span><kbd>Ctrl K</kbd></button>
    <dialog ref={dialog} className="workspace-finder" aria-labelledby="workspace-finder-title" onClose={() => {
      onClose();
      if (!openingGuide.current) trigger.current?.focus();
    }}>
      <div className="workspace-finder-heading"><div><p className="eyebrow">Go directly to your next task</p><h2 id="workspace-finder-title">Find a workspace</h2></div><button className="icon-button" type="button" aria-label="Close workspace finder" onClick={() => dialog.current?.close()}><X size={18}/></button></div>
      <label className="workspace-finder-search"><Search size={18}/><input ref={input} aria-label="Search workspaces" placeholder="Try refund, move out, statement or payments" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <p className="workspace-finder-count" role="status">{results.length} pages · {tasks.length} task guides available to your role{loading ? " · Checking guide access…" : loadFailed ? " · Guides unavailable. Close and reopen search to retry." : ""}</p>
      <nav aria-label="Workspace search results" className="workspace-finder-results">
        {tasks.map(guide => <article key={guide.id} className="workspace-task-result"><strong>{guide.title}</strong><small>{guide.description}</small><div className="workspace-task-actions"><Link href={guide.steps[0].route} onClick={() => dialog.current?.close()}>Open page <ArrowUpRight size={15}/></Link><button type="button" onClick={() => { openingGuide.current = true; dialog.current?.close(); onGuide(guide.id); }}>Guide me <ArrowUpRight size={15}/></button></div></article>)}
        {results.map(item => <Link key={item.href} href={item.href} onClick={() => dialog.current?.close()}><span><strong>{item.label}</strong><small>{item.group} · Open page</small></span><ArrowUpRight size={17}/></Link>)}{!results.length && !tasks.length && !loading && <div className="empty-state"><strong>No matching workspace or task</strong><p>Try a shorter keyword, or ask your administrator about access.</p></div>}</nav>
      <footer>Open a page or choose Guide me for step-by-step help. Save unfinished work before changing pages. Use workspace filters for customer and unit records.</footer>
    </dialog>
  </>;
}
