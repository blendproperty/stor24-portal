/**
 * Shared visual identity for customer-facing billing documents (invoice,
 * statement) — deliberately matches the customer-facing email brand already
 * live in src/lib/email.ts (stor24ReservationHeldHtml, the verification
 * email), NOT the internal staff-app palette in src/app/globals.css. Those
 * are two different brand contexts in this codebase already: globals.css
 * (--ink, --navy, --orange: #f36b21, font "Satoshi") styles the CRM screens
 * staff use; this file styles what a real customer receives, so it follows
 * the wordmark/colours/type stack that email.ts already established for
 * that audience (Arial/Helvetica — safe, no font embedding needed for a
 * server-rendered document; cream background #f5f3ea; near-black ink
 * #071411; orange accent #ff5a0a).
 *
 * No new npm dependency. This renders HTML, not a binary PDF — see the
 * doc comment at the top of invoice-renderer.ts for why.
 */
import { escapeEmailHtml } from "@/lib/email";

export const BRAND = {
  bg: "#f5f3ea",
  surface: "#ffffff",
  ink: "#071411",
  muted: "#52615b",
  mutedSoft: "#7b8883",
  accent: "#ff5a0a",
  line: "#dfe3df",
  panel: "#071411",
  panelMuted: "#aebcb6",
  panelText: "#ffffff",
} as const;

export function escapeHtml(value: string): string {
  return escapeEmailHtml(value);
}

/** The "ST◆R24" wordmark, identical markup to email.ts's templates. */
export function wordmarkHtml(size = 30): string {
  return `<span style="font-size:${size}px;line-height:1;font-weight:900;letter-spacing:-1.5px;color:${BRAND.ink};">ST<span style="color:${BRAND.accent};font-size:${size - 2}px;">&#11042;</span>R<sup style="font-size:${Math.round(size * 0.45)}px;letter-spacing:-1px;">24</sup></span>`;
}

export function formatZar(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return `R${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Wraps body content in the shared document shell: cream page background,
 * white card, orange top rule, dark footer with the tagline already used
 * in every other customer-facing email — so an invoice/statement lands
 * looking like it came from the same company as the reservation-held and
 * verification emails, not a separate system.
 */
export function documentShellHtml(input: { title: string; preheader: string; bodyHtml: string; footerNote?: string }): string {
  const preheader = escapeHtml(input.preheader);
  const footerNote = input.footerNote ? escapeHtml(input.footerNote) : null;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};color:${BRAND.ink};font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${BRAND.bg};">
    <tr><td align="center" style="padding:28px 14px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:${BRAND.surface};border:1px solid ${BRAND.line};border-radius:22px;overflow:hidden;">
        <tr><td style="height:7px;background:${BRAND.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:26px 32px 6px;">${wordmarkHtml(30)}</td></tr>
        <tr><td style="padding:6px 32px 30px;">${input.bodyHtml}</td></tr>
        <tr><td style="padding:18px 32px;background:${BRAND.panel};color:${BRAND.panelMuted};font-size:12px;line-height:1.5;">
          ${footerNote ? `<div style="margin-bottom:6px;color:${BRAND.panelText};">${footerNote}</div>` : ""}
          Safe space. Smart storage. Stor24.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
