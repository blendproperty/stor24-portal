export function contentSecurityPolicy(nonce?: string) {
  return [
    "default-src 'self'",
    `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ""}${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'", "object-src 'none'",
    "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data: https:",
    "font-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'",
    "base-uri 'self'", "form-action 'self' https://paynow.netcash.co.za",
  ].join("; ");
}

export function pageSecurityHeaders(headers: Headers) {
  // Overwrite supplied nonce/CSP headers; only this request's random value is trusted.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const requestHeaders = new Headers(headers);
  const policy = contentSecurityPolicy(nonce);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);
  return { requestHeaders, policy };
}
