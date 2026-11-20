import type { z } from "zod";
import { sanitizeRichText, stripHtml } from "../common/sanitize";
import type { deliverablesSchema } from "./task-content";

export function sanitizeDeliverables(items: z.infer<typeof deliverablesSchema> = []) {
  return items.map((item) => ({
    ...item,
    title: stripHtml(item.title),
    ...(item.detail !== undefined ? { detail: sanitizeRichText(item.detail) } : {}),
    done: item.status ? item.status === "completed" : item.done,
  }));
}

export function sanitizeTaskDescription(
  description?: string | null,
  items: z.infer<typeof deliverablesSchema> = [],
) {
  let html = description ?? "";
  if (items.length && !/data-type="taskList"/i.test(html)) {
    const escape = (value: string) =>
      stripHtml(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    html +=
      '<ul data-type="taskList">' +
      items
        .map((item) => {
          const checked = item.status ? item.status === "completed" : item.done;
          return (
            '<li data-type="taskItem" data-checked="' +
            checked +
            '"><label><input type="checkbox"' +
            (checked ? " checked" : "") +
            "></label><div><p>" +
            escape(item.title) +
            "</p>" +
            (item.detail ?? "") +
            "</div></li>"
          );
        })
        .join("") +
      "</ul>";
  }
  return sanitizeRichText(html, true);
}
