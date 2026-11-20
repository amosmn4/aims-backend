import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { deliverablesSchema } from "./task-content";

const id = z.string().uuid();
const text = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      Array.from(value).every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ),
    "Use a single line without control characters",
  );
export const departmentId = z.string().regex(/^[a-z][a-z0-9-]{0,19}$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid date");
const money = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000_000)
  .refine(
    (value) => Math.abs(Math.round(value * 100) - value * 100) < 0.01,
    "Use no more than two decimal places",
  );
const ids = z
  .array(id)
  .max(500)
  .refine((values) => new Set(values).size === values.length);
export const settingsSchema = z
  .object({
    company: text,
    reminderDays: z.number().int().min(1).max(30),
    remindersEnabled: z.boolean(),
    defaultDocumentAccess: z.enum(["public", "department", "project", "restricted"]),
  })
  .strict();
export const schemas = {
  departments: z
    .object({
      id: departmentId,
      name: text,
      blurb: z.string().max(1000),
      modules: z.array(text).max(50),
    })
    .strict(),
  people: z.object({ id, name: text, title: text, dept: departmentId.nullable() }).strict(),
  clients: z
    .object({
      id,
      name: text,
      contact: text,
      services: z.array(text).min(1).max(50),
      assignees: ids.optional(),
      assignedDept: departmentId.optional(),
      business: id.or(z.literal("b0")).optional(),
    })
    .strict(),
  projects: z
    .object({
      id,
      name: text,
      client: id.optional(),
      lead: id,
      depts: z.array(departmentId).min(1).max(50),
      members: ids.refine((values) => values.length > 0),
      status: z.enum(["on-track", "at-risk", "delayed", "completed"]),
      stage: z.enum(["Planning", "In progress", "Review", "Completed"]),
      progress: z.number().int().min(0).max(100),
      due: date,
      summary: z.string().trim().min(1).max(5000),
      business: id.or(z.literal("b0")).optional(),
    })
    .strict(),
  tasks: z
    .object({
      id,
      title: text,
      description: z.string().max(10000).optional(),
      project: id.or(z.literal("")),
      assignee: id,
      due: date,
      priority: z.enum(["Urgent", "High", "Medium", "Low"]),
      status: z.enum(["To do", "In progress", "Done", "Blocked", "Cancelled"]),
      ceoComment: z.string().max(10000).optional(),
      business: id.or(z.literal("b0")).optional(),
      weekStart: date.optional(),
      source: z.enum(["project", "planned", "ad_hoc", "contingency"]).optional(),
      subtasks: deliverablesSchema.optional(),
    })
    .strict(),
  reports: z
    .object({
      id,
      title: text,
      type: z.enum(["Monthly", "Project update", "Weekly department", "Ad-hoc"]),
      project: id.optional(),
      dept: departmentId,
      author: id,
      date,
      progress: z.string().max(10000).optional(),
      blockers: z.string().max(10000).optional(),
      next: z.string().max(10000).optional(),
      reviewed: z.boolean(),
      comment: z.string().max(10000).optional(),
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional(),
      status: z.enum(["draft", "submitted"]).optional(),
      business: id.or(z.literal("b0")).optional(),
      taskIds: ids.optional(),
      attachments: ids.optional(),
      taskSnapshots: z
        .array(
          z.object({
            id,
            title: text,
            status: z.string(),
            due: date,
            source: z.string(),
            priority: z.enum(["Urgent", "High", "Medium", "Low"]).optional(),
            subtasks: deliverablesSchema.optional(),
          }),
        )
        .optional(),
      leaveSnapshot: z
        .array(z.object({ start: date, end: date, note: z.string().nullable().optional() }))
        .optional(),
    })
    .strict(),
  tenders: z
    .object({
      id,
      title: text,
      issuer: text,
      value: money,
      due: date,
      stage: z.enum([
        "Identified",
        "Under application",
        "Submitted",
        "Withdrawn",
        "Cancelled",
        "Won",
        "Lost",
      ]),
      members: ids.refine((values) => values.length > 0),
      notes: z.string().max(5000).optional(),
    })
    .strict(),
  clientRequests: z
    .object({
      id,
      title: text,
      client: id.optional(),
      prospectClientName: text.optional(),
      source: z.enum(["operations", "marketing"]),
      received: date,
      handler: id,
      assignedDept: departmentId.optional(),
      business: id.or(z.literal("b0")).optional(),
      status: z.enum(["Received", "In progress", "Closed"]),
      notes: z.string().max(5000).optional(),
    })
    .strict()
    .refine(
      (request) => !!request.client !== !!request.prospectClientName,
      "Choose an existing client or enter a prospective client name, not both.",
    ),
  businesses: z.object({ id: id.or(z.literal("b0")), name: text, sector: text }).strict(),
  businessFinance: z
    .object({
      id,
      business: id.or(z.literal("b0")),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      date,
      description: z.string().trim().min(1).max(5000),
      revenue: money,
      expenses: money,
      note: z.string().max(5000).optional(),
    })
    .strict(),
  documents: z
    .object({
      id,
      name: text,
      folder: text,
      access: z.enum(["public", "department", "project", "restricted"]),
      owner: id,
      updated: date,
      project: id.optional(),
      task: id.optional(),
      weeklyRef: z.string().max(100).optional(),
      report: id.optional(),
      version: z.number().int().min(1).optional(),
      dept: departmentId.optional(),
      allowed: ids.optional(),
      fileKey: id.optional(),
      mime: z.string().max(200).optional(),
      sample: z.literal(false).optional(),
    })
    .strict(),
  moduleRecords: z
    .object({
      id,
      dept: departmentId,
      module: text,
      title: text,
      owner: id,
      date,
      status: z.enum(["Planned", "In progress", "Completed", "Blocked"]),
      notes: z.string().trim().min(1).max(10000),
      amount: money.optional(),
    })
    .strict(),
  templates: z.object({ id, name: text, progress: text, blockers: text, next: text }).strict(),
};
export type Collection = keyof typeof schemas;
export type Records = { [K in Collection]: z.infer<(typeof schemas)[K]> };
export type OpsPerson = Records["people"] & {
  userId: string | null;
  role: "ceo" | "staff" | "system_admin";
  active: boolean;
};
export type ModulePermissions = Partial<
  Record<"water" | "blog" | "ledger" | "inventory" | "tender", "view" | "manage">
>;
export type Viewer = OpsPerson & {
  sessionId: string;
  sessionVersion?: number;
  email: string;
  modules?: ModulePermissions;
  impersonation?: { staffId: string; userId: string; name: string; email: string };
};
export type Workspace = { [K in Collection]: Records[K][] } & {
  version: 1;
  accounts: {
    id: string;
    personId: string;
    email: string;
    role: "ceo" | "staff" | "system_admin";
    active: boolean;
    hasPassword: boolean;
    modules?: ModulePermissions;
  }[];
  businessAccess: {
    person: string;
    business: string;
    manage?: boolean;
    finance?: "view" | "manage";
  }[];
  staffBusiness: { person: string; business: string }[];
  settings: z.infer<typeof settingsSchema>;
};
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  return result.data;
}
export const revisionSchema = z.number().int().nonnegative();
export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(200),
    password: z.string().min(1).max(128),
    remember: z.boolean().default(false),
  })
  .strict();
export const passwordSchema = z
  .string()
  .min(12)
  .max(72)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Use a password no longer than 72 UTF-8 bytes",
  );
export const inviteSchema = z
  .object({
    personId: id.optional(),
    name: text.optional(),
    title: text.optional(),
    dept: departmentId.nullable().optional(),
    email: z.string().trim().toLowerCase().email().max(200),
    role: z.enum(["ceo", "staff"]),
  })
  .strict();
