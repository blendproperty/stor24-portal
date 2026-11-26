"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function WalkInPhotoPreparation({ visitId, facilityId, customerName }: { visitId: string; facilityId: string; customerName: string }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function prepare() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/walk-in/photo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitId, facilityId, identityChecked: checked }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(typeof result.error === "string" ? result.error : "Could not prepare the access photo.");
      setMessage("Photo step prepared. It opens on Counter once the agreement is signed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare the access photo.");
    } finally {
      setBusy(false);
    }
  }
  return <form onSubmit={event => { event.preventDefault(); void prepare(); }}>
    <label><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} required disabled={busy} /> I checked the original ID against the booking for {customerName}.</label>
    <button className="button button-secondary" disabled={!checked || busy}>{busy ? "Preparing…" : "Enable access photo on this tablet"}</button>
    {message && <p role="status">{message}</p>}
  </form>;
}
