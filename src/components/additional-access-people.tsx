"use client";

import { useEffect, useState } from "react";

type Person = { id: string; name: string; status: string };

export function AdditionalAccessPeople({ reservationId }: { reservationId: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/tenant/additional-access-people?${new URLSearchParams({ reservationId })}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); if (!controller.signal.aborted) { setPeople(result.data); setLoaded(true); } })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Please refresh."); });
    return () => controller.abort();
  }, [reservationId]);

  async function add() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/tenant/additional-access-people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reservationId, name }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setPeople(current => [...current, result.data]); setName("");
    } catch (err) { setError(err instanceof Error ? err.message : "Please try again."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/tenant/additional-access-people?${new URLSearchParams({ reservationId, id })}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setPeople(current => current.filter(person => person.id !== id));
    } catch (err) { setError(err instanceof Error ? err.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return <section className="tenant-card">
    <h3>Additional people</h3>
    <p>Nominate people who may need access to this unit. A nomination does not register a face or grant access. Your store will confirm the next steps.</p>
    {loaded && <form onSubmit={event => { event.preventDefault(); void add(); }}>
      <label>Full name <input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={100} required disabled={busy} /></label>
      <button className="tenant-secondary" disabled={busy}>Add person</button>
    </form>}
    {people.length > 0 && <ul>{people.map(person => <li key={person.id}>{person.name} — {person.status.replaceAll("_", " ").toLowerCase()}, access not active <button type="button" disabled={busy} onClick={() => void remove(person.id)}>Remove person</button></li>)}</ul>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
