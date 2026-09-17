import { Injectable, type ArgumentMetadata, type PipeTransform } from "@nestjs/common";
import sanitizeHtml from "sanitize-html";

/* ---------- Rich text (blog content) ---------- */

// Must match FONT_FAMILIES in the frontend rich-text-editor.tsx toolbar exactly.
export const RICH_TEXT_FONT_FAMILIES = [
  "Arial",
  "Helvetica",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
  "Garamond",
  "Courier New",
];

const FONT_FAMILY_PATTERN = new RegExp(
  `^"?(${RICH_TEXT_FONT_FAMILIES.map((f) => f.replace(/ /g, "\\s")).join("|")})"?$`,
  "i",
);
const COLOR = [
  /^#[0-9a-f]{6}$/i,
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/i,
];
const TEXT_ALIGN = [/^(left|center|right|justify)$/];
const LINE_HEIGHT = [/^(normal|[0-3](\.\d{1,2})?)$/];
const PX_WIDTH = [/^\d{1,4}px$/];

// Public content boundary: tags, attributes and style values pinned to what the editor emits.
// Keep in lockstep with frontend/src/components/safe-html.tsx.
export const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "h2",
    "h3",
    "blockquote",
    "strong",
    "em",
    "u",
    "s",
    "sub",
    "sup",
    "ul",
    "ol",
    "li",
    "a",
    "span",
    "table",
    "colgroup",
    "col",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    span: ["style"],
    p: ["style", "class"],
    h2: ["style"],
    h3: ["style"],
    table: ["style"],
    col: ["style"],
    th: ["colspan", "rowspan", "colwidth", "style"],
    td: ["colspan", "rowspan", "colwidth", "style"],
  },
  allowedClasses: { p: ["drop-cap"] },
  allowedStyles: {
    span: {
      color: COLOR,
      "background-color": COLOR,
      "font-family": [FONT_FAMILY_PATTERN],
      "font-size": [/^\d{1,2}(\.\d)?(px|pt|em|rem)$/],
      "line-height": LINE_HEIGHT,
    },
    p: { "text-align": TEXT_ALIGN, "line-height": LINE_HEIGHT },
    h2: { "text-align": TEXT_ALIGN },
    h3: { "text-align": TEXT_ALIGN },
    table: { width: PX_WIDTH, "min-width": PX_WIDTH },
    col: { width: PX_WIDTH, "min-width": PX_WIDTH },
    th: { "text-align": TEXT_ALIGN },
    td: { "text-align": TEXT_ALIGN },
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  transformTags: {
    // Only "_blank" survives as a target; rel is always forced so new tabs can't reach window.opener.
    a: (tagName, attribs) => {
      const { target, ...rest } = attribs;
      return {
        tagName,
        attribs: {
          ...rest,
          ...(target === "_blank" && { target }),
          rel: "noopener noreferrer nofollow",
        },
      };
    },
  },
};

export function sanitizeRichText(html: string): string;
export function sanitizeRichText(html: string | null | undefined): string | null | undefined;
export function sanitizeRichText(html: string | null | undefined) {
  return html == null ? html : sanitizeHtml(html, RICH_TEXT_OPTIONS);
}

/* ---------- Plain text (every other input) ---------- */

// Real HTML element names only, so text like "salary < 50k" or "x<y and a>b" is left alone.
const HTML_TAG = new RegExp(
  "<!--|<\\/?(?:a|abbr|address|area|article|aside|audio|b|base|bdi|bdo|blockquote|body|br|button|" +
    "canvas|caption|center|cite|code|col|colgroup|data|datalist|dd|del|details|dfn|dialog|div|dl|dt|" +
    "em|embed|fieldset|figcaption|figure|font|footer|form|frame|frameset|h[1-6]|head|header|hr|html|" +
    "i|iframe|img|input|ins|kbd|label|legend|li|link|main|map|mark|marquee|math|menu|meta|meter|nav|" +
    "noscript|object|ol|optgroup|option|output|p|param|picture|pre|progress|q|s|samp|script|section|" +
    "select|slot|small|source|span|strike|strong|style|sub|summary|sup|svg|table|tbody|td|template|" +
    "textarea|tfoot|th|thead|time|title|tr|track|u|ul|var|video|wbr)(?=[\\s/>])",
  "i",
);
const PLAIN_TEXT_OPTIONS: sanitizeHtml.IOptions = { allowedTags: [], allowedAttributes: {} };
const ENTITY_DECODE: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/** Removes HTML tags from plain text without otherwise altering it. */
export function stripHtml(value: string): string {
  let out = value;
  // Re-check after decoding, in case escaped markup re-forms a tag.
  for (let i = 0; i < 3 && HTML_TAG.test(out); i++) {
    out = sanitizeHtml(out, PLAIN_TEXT_OPTIONS).replace(
      /&(amp|lt|gt|quot|#39);/g,
      (m) => ENTITY_DECODE[m],
    );
  }
  return out;
}

/* ---------- Global input pipe ---------- */

const ALLOW_HTML = Symbol("allowHtmlFields");
// Never touch credentials: altering them would break sign-in.
const SECRET_KEY = /pass(word)?|token|secret|signature|hash/i;

/** Marks a DTO field as rich text; it's skipped by SanitizeInputPipe and must be sanitized by its service. */
export function AllowHtml(): PropertyDecorator {
  return (target, key) => {
    const ctor = target.constructor as { [ALLOW_HTML]?: Set<string> };
    ctor[ALLOW_HTML] = new Set([...(ctor[ALLOW_HTML] ?? []), String(key)]);
  };
}

function allowedHtmlFields(metatype: unknown): Set<string> {
  let fields = new Set<string>();
  for (let c = metatype as { [ALLOW_HTML]?: Set<string> } | null; c; c = Object.getPrototypeOf(c)) {
    fields = new Set([...fields, ...(c[ALLOW_HTML] ?? [])]);
  }
  return fields;
}

function clean(value: unknown, allowHtml: Set<string>, depth: number): unknown {
  if (typeof value === "string") return stripHtml(value);
  if (depth > 12 || value === null || typeof value !== "object" || Buffer.isBuffer(value))
    return value;
  if (Array.isArray(value)) return value.map((v) => clean(v, new Set(), depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = allowHtml.has(key) || SECRET_KEY.test(key) ? v : clean(v, new Set(), depth + 1);
  }
  return out;
}

/** Strips HTML from every string in request bodies and query strings, except @AllowHtml fields. */
@Injectable()
export class SanitizeInputPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== "body" && metadata.type !== "query") return value;
    return clean(value, allowedHtmlFields(metadata.metatype), 0);
  }
}
