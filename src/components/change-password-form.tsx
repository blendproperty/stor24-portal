"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function ChangePasswordForm() {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [signInRequired, setSignInRequired] = useState(false);
  const submitting = useRef(false), feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (message) feedback.current?.focus(); }, [message]);
  async function submit(formData: FormData) {
    if (submitting.current || signInRequired) return;
    setMessage("");
    if (formData.get("password") !== formData.get("confirmation")) { setMessage("The new passwords do not match."); return; }
    submitting.current = true; setBusy(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/auth/change-password", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: formData.get("currentPassword"), password: formData.get("password") }) });
      const payload = await response.json();
      if (response.status >= 500) throw new Error("UNCONFIRMED_PASSWORD_CHANGE");
      if (!response.ok) {
        const error = typeof payload?.error === "string" ? payload.error : typeof payload?.error?.message === "string" ? payload.error.message : "The password could not be changed.";
        setMessage(error);
        if (response.status === 401) setSignInRequired(true);
        return;
      }
      if (payload?.data?.changed !== true) throw new Error("UNCONFIRMED_PASSWORD_CHANGE");
      router.replace("/login?password=changed"); router.refresh();
    } catch {
      setSignInRequired(true);
      setMessage("We could not confirm whether your password changed. Go to sign in and try your new password first. If it does not work, use your previous password or the reset-password option.");
    } finally {
      clearTimeout(timeout); submitting.current = false; setBusy(false);
    }
  }
  return <form action={submit} className="invite-form" aria-busy={busy}><label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label><label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label><label>Confirm new password<input name="confirmation" type="password" autoComplete="new-password" minLength={12} required /></label><p className="panel-subtitle">Use 12+ characters with upper and lowercase letters, a number and a symbol. Changing it signs out every session.</p>{message ? <p ref={feedback} tabIndex={-1} className="form-error" role="alert">{message}</p> : null}<button className="button button-primary" disabled={busy || signInRequired} type="submit">{busy ? "Changing…" : "Change password"}</button>{signInRequired ? <Link href="/login" className="button button-primary">Go to sign in</Link> : null}</form>;
}
