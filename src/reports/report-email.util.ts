export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export const REPORT_EMAIL_KEYS = [
  "report_submitted",
  "board_pack",
  "pipeline_weekly",
  "debtors_fortnightly",
  "water_monthly",
] as const;
export type ReportEmailKey = (typeof REPORT_EMAIL_KEYS)[number];

// Default when a person has no saved choice yet.
export const REPORT_EMAIL_DEFAULTS: Record<ReportEmailKey, boolean> = {
  report_submitted: true,
  board_pack: true,
  pipeline_weekly: false,
  debtors_fortnightly: false,
  water_monthly: false,
};

export function emailTable(rows: [string, string][]) {
  return `<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="border-bottom:1px solid #e5e7eb;color:#555">${escapeHtml(k)}</td><td style="border-bottom:1px solid #e5e7eb;font-weight:600">${escapeHtml(v)}</td></tr>`,
    )
    .join("")}</table>`;
}
