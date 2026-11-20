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
