const RESOURCE_LABEL: Record<string, string> = {
  "blog-posts": "blog post",
  "client-requests": "client request",
  "company-settings": "company settings",
  "department-reports": "report",
  "report-email-subscriptions": "report email settings",
  "finance-reports": "finance report",
  "finance-uploads": "finance upload",
  "recruitment-funnels": "recruitment numbers",
  "service-lines": "service line",
  "hrms-licenses": "HRMS licence",
  "it-systems": "system",
  "payroll-compliance": "payroll filing",
  "timeline-extensions": "timeline extension",
  "tender-requirement-templates": "tender requirement template",
  "usage-uploads": "water usage upload",
  inventory: "inventory item",
  users: "staff member",
  customers: "water customer",
  meters: "water meter",
  readings: "meter reading",
  zones: "water zone",
  chat: "AI chat",
  preferences: "alert settings",
  channels: "alert channels",
  overrides: "access for a person",
  roles: "role permissions",
  events: "calendar event",
  uptime: "uptime record",
};

const SUB_ACTION: Record<string, string | ((method: string) => string)> = {
  void: "voided",
  pay: "marked as paid",
  payments: (m) => (m === "DELETE" ? "removed a payment from" : "recorded a payment on"),
  review: "reviewed",
  messages: "replied on",
  comments: "commented on",
  stage: "moved",
  status: "changed the status of",
  route: "routed",
  "convert-to-project": "turned into a project",
  "convert-to-contract": "turned into a contract",
  team: (m) =>
    m === "DELETE" ? "removed someone from the team of" : "added someone to the team of",
  access: "changed who can see",
  "access-grants": (m) =>
    m === "DELETE" ? "removed someone's access to" : "gave someone access to",
  image: "changed the image of",
  publish: "published",
  uptime: "recorded uptime for",
  placements: (m) => (m === "DELETE" ? "removed a placement from" : "added a placement to"),
  milestones: "added a milestone to",
  "sweep-now": "refreshed alerts for",
};

const AREA_LABEL: Record<string, string> = {
  blog: "Blog",
  water_ai: "Water AI",
  hrms_licenses: "HRMS licences",
  it_systems: "IT systems",
};

const NAME_KEYS = [
  "name",
  "title",
  "fullName",
  "invoiceNumber",
  "referenceNumber",
  "contractNumber",
  "assetTag",
  "filingType",
];

/** Areas that record housekeeping rather than business changes. */
export const NOISE_AREAS = ["notifications"];

export function areaLabel(entityType: string) {
  if (AREA_LABEL[entityType]) return AREA_LABEL[entityType];
  const words = entityType.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function recordName(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  for (const key of NAME_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 80);
  }
  return null;
}

function singular(resource: string) {
  if (RESOURCE_LABEL[resource]) return RESOURCE_LABEL[resource];
  return resource.replace(/-/g, " ").replace(/ies$/, "y").replace(/s$/, "");
}

/** Turns "PATCH /api/v1/tenders/:id/stage" into "moved tender". */
export function describeAction(action: string): string {
  if (action === "view_as.start") return "started a view of";
  if (action === "view_as.end") return "ended a view of";
  const [method, rawPath = ""] = action.split(" ");
  const segments = rawPath.split("/").filter(Boolean).slice(2);
  const isParam = (s?: string) => !!s && s.startsWith(":");
  const last = segments.length - 1;
  let resource = "";
  let sub: string | undefined;
  for (let i = last; i >= 0; i--) {
    if (isParam(segments[i])) continue;
    if (isParam(segments[i - 1]) && i - 2 >= 0 && SUB_ACTION[segments[i]]) {
      sub = segments[i];
      resource = segments[i - 2];
    } else {
      resource = segments[i];
    }
    break;
  }
  const thing = singular(resource);
  if (sub) {
    const verb = SUB_ACTION[sub];
    return `${typeof verb === "function" ? verb(method) : verb} ${thing}`;
  }
  const hasId = isParam(segments[last]);
  if (method === "DELETE") return `deleted ${thing}`;
  if (method === "POST" && !hasId) return `added ${thing}`;
  return `updated ${thing}`;
}

export function summarize(actor: string, action: string, name: string | null) {
  return `${actor} ${describeAction(action)}${name ? ` “${name}”` : ""}`;
}
