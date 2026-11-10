import { escapeEmailHtml as escapeHtml } from "@/lib/email";

export function operationalPrintTable(title: string, notes: string[], columns: string[], rows: string[][]) {
  const headers = columns.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join("");
  const body = rows.map(([unit, ...values]) => `<tr><th scope="row">${escapeHtml(unit)}</th>${values.map(value => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("");
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      body{font:14px system-ui,sans-serif;margin:24px;color:#111} table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #444;padding:5px;text-align:left} td{min-width:3rem} td:last-child{width:28%}
      tr{break-inside:avoid} thead{display:table-header-group}
      @media print{body{margin:0}.screen{display:none}} @page{size:A4;margin:14mm}
    </style>
    <h1>${escapeHtml(title)}</h1>
    <p class="screen">Use your browser’s Print command to print this sheet.</p>
    ${notes.map(note => `<p>${escapeHtml(note)}</p>`).join("")}
    <table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>
    </html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}
