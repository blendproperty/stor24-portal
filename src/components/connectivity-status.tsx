"use client";

import { useSyncExternalStore } from "react";

function subscribeToConnectivity(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getConnectivitySnapshot() {
  return navigator.onLine;
}

export function ConnectivityStatus({ compact = false }: { compact?: boolean }) {
  const online = useSyncExternalStore(subscribeToConnectivity, getConnectivitySnapshot, () => true);

  if (compact) {
    return (
      <div className="connectivity-compact" data-online={online} aria-live="polite">
        <span aria-hidden="true" />
        <small>{online ? "Online · Live data" : "Offline · Actions unavailable"}</small>
      </div>
    );
  }

  if (online) return null;

  return (
    <div className="connectivity-banner is-offline" role="status" aria-live="assertive">
      <strong>Offline mode</strong>
      <span>Live data and actions are unavailable. Nothing will be queued or saved.</span>
    </div>
  );
}
