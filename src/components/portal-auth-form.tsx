"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type Props =
  | { mode: "login" }
  | { mode: "setup"; token: string };

export function PortalAuthForm(props: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);

  async function submit(formData: FormData) {
    setBusy(true);
    setError("");
    const setup = props.mode === "setup";
    const response = await fetch(mfaRequired ? "/api/auth/mfa/verify" : setup ? "/api/auth/setup" : "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(mfaRequired ? { code: formData.get("code") } : {
          ...(setup ? { token: props.token, name: formData.get("name") } : {}),
          email: formData.get("email"), password: formData.get("password"),
        }),
      }),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(payload.error ?? "Unable to continue.");
      return;
    }
    if (payload.data?.mfaRequired) { setMfaRequired(true); return; }
    const next = setup ? "/" : searchParams.get("next") || "/";
    router.replace(next.startsWith("/") ? next : "/");
    router.refresh();
  }

  return (
    <form className="portal-auth-form" action={submit}>
      {mfaRequired ? <><div className="mfa-login-intro"><ShieldCheck size={22}/><div><strong>Two-step verification</strong><p>Enter the 6-digit code from your authenticator app, or one unused recovery code.</p></div></div><label><span>Verification code</span><div className="portal-field"><KeyRound size={18}/><input name="code" autoComplete="one-time-code" inputMode="numeric" required autoFocus /></div></label></> : <>
      {props.mode === "setup" ? (
        <label>
          <span>Full name</span>
          <div className="portal-field"><UserRound size={18} /><input name="name" autoComplete="name" required minLength={2} /></div>
        </label>
      ) : null}
      <label>
        <span>Work email</span>
        <div className="portal-field"><Mail size={18} /><input name="email" type="email" autoComplete="email" required /></div>
      </label>
      <label>
        <span>Password</span>
        <div className="portal-field">
          <LockKeyhole size={18} />
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={props.mode === "setup" ? "new-password" : "current-password"}
            required
            minLength={props.mode === "setup" ? 12 : 1}
          />
          <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </label>
      {props.mode === "setup" ? (
        <p className="password-guidance"><ShieldCheck size={15} /> Use 12+ characters with upper and lowercase letters, a number and a symbol.</p>
      ) : null}</>}
      {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
      <button className="portal-submit" disabled={busy} type="submit">
        {busy ? "Securing access…" : mfaRequired ? "Verify and sign in" : props.mode === "setup" ? "Create owner account" : "Sign in to portal"}
        <ArrowRight size={18} />
      </button>
      {props.mode === "login" && !mfaRequired ? <p className="portal-auth-footer"><Link href="/forgot-password">Forgot password?</Link></p> : null}
    </form>
  );
}
