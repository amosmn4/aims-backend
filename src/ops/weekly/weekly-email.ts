import { sanitizeRichText, stripHtml } from "../../common/sanitize";
import type { WeeklyPhase } from "./weekly.schemas";
import type { WeeklyService } from "./weekly.service";

type Overview = Awaited<ReturnType<WeeklyService["overview"]>>;
export const escapeEmail = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
const taskStatus = (status: string) =>
  status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export function renderWeeklyEmail(data: Overview, phase: WeeklyPhase, origin: string) {
  const label = phase === "plan" ? "plans" : "reports";
  const subject = `Amsol weekly ${label} | Week of ${data.weekStart}`;
  const rows = data.staff.map((person) => {
    const row = person[phase];
    const submitted = !!row?.submittedAt;
    const status = submitted
      ? `Submitted${row?.late ? " late" : ""}`
      : row?.returnedAt
        ? "Returned for correction"
        : row
          ? "Draft, not submitted"
          : "Not submitted";
    const counts =
      submitted && row
        ? Object.entries(row.counts)
            .map(([key, count]) => `${count} ${key.replaceAll("_", " ")}`)
            .join(", ")
        : "";
    const brief = submitted && row ? (row.submission.note ?? "") : "";
    const url = `${origin}/weekly-reports?week=${data.weekStart}&phase=${phase}&staff=${encodeURIComponent(person.id)}`;
    return {
      name: person.name,
      url,
      status,
      brief,
      hasTaskNotes:
        submitted && !!row?.submission.items.some((item) => stripHtml(item.detail).trim()),
      counts,
      submission: submitted ? row?.submission : null,
    };
  });
  const submitted = rows.filter((row) => row.status.startsWith("Submitted")).length;
  const text = [
    subject,
    `Reporting week: ${data.weekStart} to ${data.weekEnd}`,
    `${submitted} of ${rows.length} staff submitted.`,
    ...rows.map((row) => {
      const details = row.submission
        ? [
            row.brief && `Notes: ${stripHtml(row.brief)}`,
            ...(row.submission.leave ?? []).map(
              (leave) =>
                `Leave: ${leave.start} to ${leave.end}${leave.note ? ` | ${leave.note}` : ""}`,
            ),
            ...row.submission.items.map(
              (item) =>
                `- ${item.title} (${taskStatus(item.status)})${stripHtml(item.detail).trim() ? `: ${stripHtml(item.detail)}` : ""}`,
            ),
            row.submission.noWorkReason && `No work / absence: ${row.submission.noWorkReason}`,
            row.submission.blockers && `Blockers and support: ${row.submission.blockers}`,
            row.submission.nextWeek && `Next week: ${row.submission.nextWeek}`,
          ]
            .filter(Boolean)
            .join("\n")
        : "No submitted details.";
      return `${row.name}: ${row.status}\n${row.counts}\n${details}\n${row.url}`;
    }),
  ].join("\n\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f3f4f6;color:#111827;font-family:Arial,sans-serif"><main style="max-width:760px;margin:24px auto;padding:24px;background:#fff;border:1px solid #d1d5db"><h1 style="font-size:24px">Weekly staff ${label}</h1><p>${escapeEmail(data.weekStart)} to ${escapeEmail(data.weekEnd)} | Africa/Nairobi</p><p><strong>${submitted} of ${rows.length} staff submitted</strong></p>${rows.map((row) => `<section style="margin:18px 0;padding:16px;border:1px solid #d1d5db;border-radius:8px"><h2 style="margin:0 0 8px;font-size:18px"><a href="${escapeEmail(row.url)}" style="color:#1d4ed8">${escapeEmail(row.name)}</a></h2><p style="margin:0 0 12px;color:#4b5563">${escapeEmail(row.status)}${row.counts ? ` | ${escapeEmail(row.counts)}` : ""}</p>${row.submission ? `${row.brief ? `<div style="white-space:pre-wrap"><strong>Notes:</strong> ${sanitizeRichText(row.brief)}</div>` : ""}${(row.submission.leave ?? []).map((leave) => `<p><strong>Leave:</strong> ${escapeEmail(leave.start)} to ${escapeEmail(leave.end)}${leave.note ? ` | ${escapeEmail(leave.note)}` : ""}</p>`).join("")}${row.submission.items.length ? `<table style="width:100%;border-collapse:collapse;text-align:left"><thead><tr><th style="padding:8px;border-bottom:2px solid #d1d5db">Task</th><th style="padding:8px;border-bottom:2px solid #d1d5db">Status</th>${row.hasTaskNotes ? `<th style="padding:8px;border-bottom:2px solid #d1d5db">Notes</th>` : ""}</tr></thead><tbody>${row.submission.items.map((item) => `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top">${escapeEmail(item.title)}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top">${escapeEmail(taskStatus(item.status))}</td>${row.hasTaskNotes ? `<td style="padding:8px;border-bottom:1px solid #e5e7eb;white-space:pre-wrap;vertical-align:top">${sanitizeRichText(item.detail)}</td>` : ""}</tr>`).join("")}</tbody></table>` : ""}${row.submission.noWorkReason ? `<p><strong>No work / absence:</strong> ${escapeEmail(row.submission.noWorkReason)}</p>` : ""}${row.submission.blockers ? `<p style="white-space:pre-wrap"><strong>Blockers and support:</strong> ${escapeEmail(row.submission.blockers)}</p>` : ""}${row.submission.nextWeek ? `<p style="white-space:pre-wrap"><strong>Next week:</strong> ${escapeEmail(row.submission.nextWeek)}</p>` : ""}` : `<p>No submitted details.</p>`}</section>`).join("") || "<p>No staff are expected for this week.</p>"}<p style="font-size:13px;color:#4b5563">This email is a snapshot. Select a staff name to view the full submission in Amsol Ops.</p></main></body></html>`;
  return { subject, html, text };
}
