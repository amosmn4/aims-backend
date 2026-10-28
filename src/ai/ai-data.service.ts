import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { viewerDepartmentCodes, billingViewerCodes } from "../common/department-scope";
import { readableProjectsWhere } from "../common/project-access";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import { hasResourceGrant } from "../common/has-resource-grant";
import { userCan } from "../common/capabilities";
import { DocumentsService } from "../documents/documents.service";
import { ReportAccessService } from "../reports/report-access.service";

const EXCLUDED = new Set([
  "PasswordSetupToken",
  "UserPermissionOverride",
  "ResourceAccessGrant",
  "RoleCapability",
  "PaymentLedgerSync",
  "NotificationPreference",
  "NotificationChannelPreference",
  "WaterUploadRemovalJob",
]);
const PRIVATE_FIELD =
  /password|secret|token|storage|filePath|apiKey|smtp|webhook|leaseUntil|fileHash/i;
const models = Prisma.dmmf.datamodel.models.filter((model) => !EXCLUDED.has(model.name));
const querySchema = z
  .object({
    model: z.string(),
    operation: z.enum(["rows", "count", "aggregate", "group"]),
    filters: z.string().max(12000).default("{}"),
    fields: z.array(z.string()).max(30).nullable().optional(),
    page: z.number().int().min(1).max(1000000).default(1),
    orderBy: z.string().nullable().optional(),
    direction: z.enum(["asc", "desc"]).default("desc"),
    groupBy: z.array(z.string()).max(3).default([]),
    metrics: z
      .array(
        z.object({ field: z.string(), operation: z.enum(["sum", "avg", "min", "max"]) }).strict(),
      )
      .max(12)
      .default([]),
  })
  .strict();
type Model = (typeof models)[number];
type Where = Record<string, unknown>;
interface Delegate {
  findMany(args: Where): Promise<Record<string, unknown>[]>;
  count(args: Where): Promise<number>;
  aggregate(args: Where): Promise<Record<string, unknown>>;
  groupBy(args: Where): Promise<Record<string, unknown>[]>;
}

export interface AiDataSource {
  model: string;
  operation: string;
  filters: Where;
  matchedRecords: number;
  coverage: unknown;
  records: { id: string; label: string; href: string | null }[];
}

export function safeAiData(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Prisma.Decimal) return value.toString();
  if (Array.isArray(value)) return value.map(safeAiData);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !PRIVATE_FIELD.test(key))
        .map(([key, item]) => [key, safeAiData(item)]),
    );
  return value;
}

@Injectable()
export class AiDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly reports: ReportAccessService,
  ) {}

  catalog() {
    return models.map((model) => ({
      model: model.name,
      fields: this.fields(model).map(
        (field) => `${field.name}:${field.type}${field.isRequired ? "" : "?"}`,
      ),
      links: model.fields
        .filter(
          (field) =>
            field.kind === "object" &&
            field.relationFromFields?.length &&
            !EXCLUDED.has(field.type),
        )
        .map((field) => ({ model: field.type, foreignKeys: field.relationFromFields })),
    }));
  }

  async query(input: unknown, user: AuthenticatedUser) {
    const parsed = querySchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join("; "));
    const query = parsed.data;
    const model = models.find((candidate) => candidate.name === query.model);
    if (!model) throw new BadRequestException("Choose a business model from the catalog.");
    let raw: unknown;
    try {
      raw = JSON.parse(query.filters);
    } catch {
      throw new BadRequestException("Filters must be a JSON object.");
    }
    const filters = this.where(model, raw);
    const scope = await this.scope(model, user);
    const where = { AND: [filters, scope] };
    const delegate = this.delegate(model);
    const available = this.fields(model);
    const assertField = (name: string) => {
      const field = available.find((field) => field.name === name);
      if (!field)
        throw new BadRequestException(`Unknown or unavailable field: ${model.name}.${name}`);
      return field;
    };
    const metrics: Where = {};
    for (const metric of query.metrics) {
      const field = assertField(metric.field);
      if (
        ["sum", "avg"].includes(metric.operation) &&
        !["Int", "Float", "Decimal", "BigInt"].includes(field.type)
      )
        throw new BadRequestException("Sum and average require a numeric field.");
      const key = `_${metric.operation}`;
      metrics[key] = { ...((metrics[key] as Where) ?? {}), [metric.field]: true };
    }
    const dated = [
      "readingDate",
      "recordedAt",
      "paidOn",
      "transactionAt",
      "incurredOn",
      "issueDate",
      "occurredAt",
      "placedAt",
      "periodStart",
      "month",
      "startDate",
      "startsAt",
      "createdAt",
    ]
      .map((name) => available.find((field) => field.name === name && field.type === "DateTime"))
      .find(Boolean);
    const [total, coverage] = await Promise.all([
      delegate.count({ where }),
      dated
        ? delegate.aggregate({ where, _min: { [dated.name]: true }, _max: { [dated.name]: true } })
        : Promise.resolve(null),
    ]);
    let result: unknown;
    let records: Record<string, unknown>[] = [];
    if (query.operation === "count") result = { count: total };
    else if (query.operation === "aggregate")
      result = await delegate.aggregate({ where, _count: true, ...metrics });
    else if (query.operation === "group") {
      if (!query.groupBy.length) throw new BadRequestException("Choose groupBy fields.");
      for (const name of query.groupBy) assertField(name);
      const groups = await delegate.groupBy({
        where,
        by: query.groupBy,
        _count: { _all: true },
        ...metrics,
        orderBy: query.groupBy.map((name) => ({ [name]: "asc" })),
        skip: (query.page - 1) * 50,
        take: 51,
      });
      result = {
        groups: groups.slice(0, 50),
        page: query.page,
        pageSize: 50,
        nextPage: groups.length > 50 ? query.page + 1 : null,
      };
    } else {
      const fields = query.fields?.length
        ? query.fields
        : available
            .filter((field) => field.type !== "Json")
            .slice(0, 20)
            .map((field) => field.name);
      for (const name of fields) assertField(name);
      const identity = available.find((field) => field.isId)?.name;
      const orderBy = query.orderBy || dated?.name || identity || available[0]?.name;
      if (orderBy) assertField(orderBy);
      records = await delegate.findMany({
        where,
        select: Object.fromEntries(
          [...new Set([...(identity ? [identity] : []), ...fields])].map((name) => [name, true]),
        ),
        orderBy: orderBy
          ? [
              { [orderBy]: query.direction },
              ...(identity && identity !== orderBy ? [{ [identity]: "asc" }] : []),
            ]
          : undefined,
        skip: (query.page - 1) * 25,
        take: 25,
      });
      result = {
        rows: records,
        selectedFields: fields,
        page: query.page,
        pageSize: 25,
        nextPage: query.page * 25 < total ? query.page + 1 : null,
      };
    }
    const source: AiDataSource = {
      model: model.name,
      operation: query.operation,
      filters,
      matchedRecords: total,
      coverage: safeAiData(coverage),
      records: records
        .filter((row) => typeof row.id === "string")
        .map((row) => ({
          id: row.id as string,
          label: String(
            row.name ?? row.title ?? row.meterNumber ?? row.invoiceNumber ?? row.fullName ?? row.id,
          ),
          href: this.href(model.name, row),
        })),
    };
    return {
      result: safeAiData(result),
      matchedRecords: total,
      dateCoverage: {
        field: dated?.name ?? null,
        bounds: safeAiData(coverage),
        restriction: Object.keys(filters).length
          ? "Explicit filters only"
          : "All stored history; no month or active-status filter",
      },
      source,
    };
  }

  async document(id: string, user: AuthenticatedUser) {
    return this.documents.findOne(id, user);
  }

  async overview(user: AuthenticatedUser, requested: string[] = []) {
    const selected = requested.length
      ? models.filter((model) => requested.includes(model.name))
      : models;
    const results: Awaited<ReturnType<AiDataService["query"]>>[] = [];
    const unavailable: string[] = [];
    for (let offset = 0; offset < selected.length; offset += 5) {
      const chunk = await Promise.all(
        selected.slice(offset, offset + 5).map(async (model) => {
          try {
            return await this.query({ model: model.name, operation: "count", filters: "{}" }, user);
          } catch (error) {
            if (!(error instanceof ForbiddenException)) unavailable.push(model.name);
            return null;
          }
        }),
      );
      for (const result of chunk) if (result) results.push(result);
    }
    return { results, unavailable };
  }

  private fields(model: Model) {
    return model.fields.filter(
      (field) => field.kind !== "object" && !field.isList && !PRIVATE_FIELD.test(field.name),
    );
  }

  private delegate(model: Model): Delegate {
    return (this.prisma as unknown as Record<string, Delegate>)[
      model.name[0].toLowerCase() + model.name.slice(1)
    ];
  }

  private where(model: Model, input: unknown, depth = 0): Where {
    if (!input || typeof input !== "object" || Array.isArray(input) || depth > 5)
      throw new BadRequestException(
        "Use a JSON filter object with at most five nested conditions.",
      );
    const result: Where = {};
    for (const [key, value] of Object.entries(input)) {
      if (["AND", "OR", "NOT"].includes(key)) {
        if (!Array.isArray(value) || value.length > 50)
          throw new BadRequestException("Logical filters require up to fifty conditions.");
        result[key] = value.map((item) => this.where(model, item, depth + 1));
        continue;
      }
      const field = this.fields(model).find((field) => field.name === key);
      if (!field)
        throw new BadRequestException(
          `Filter on a listed scalar field. Follow foreign-key links with another query: ${key}`,
        );
      const scalar = (item: unknown) => {
        if (item === null) return null;
        if (field.type === "DateTime") {
          if (
            typeof item !== "string" ||
            !/^\d{4}-\d{2}-\d{2}T/.test(item) ||
            !/(?:Z|[+-]\d{2}:\d{2})$/.test(item) ||
            !Number.isFinite(+new Date(item))
          )
            throw new BadRequestException(
              "Date filters need a full ISO timestamp, including timezone.",
            );
          return new Date(item);
        }
        if (!["string", "number", "boolean"].includes(typeof item))
          throw new BadRequestException("Filter values must be scalar values.");
        return item;
      };
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const operators: Where = {};
        for (const [operator, operand] of Object.entries(value)) {
          if (
            ![
              "equals",
              "not",
              "gt",
              "gte",
              "lt",
              "lte",
              "contains",
              "startsWith",
              "endsWith",
              "in",
              "notIn",
            ].includes(operator)
          )
            throw new BadRequestException("Unsupported filter operator.");
          if (["in", "notIn"].includes(operator)) {
            if (!Array.isArray(operand) || operand.length > 200)
              throw new BadRequestException("Use at most two hundred values per filter.");
            operators[operator] = operand.map(scalar);
          } else operators[operator] = scalar(operand);
        }
        result[key] = operators;
      } else result[key] = scalar(value);
    }
    return result;
  }

  private async scope(
    model: Model,
    user: AuthenticatedUser,
    seen = new Set<string>(),
  ): Promise<Where> {
    if (seen.has(model.name)) return { id: { in: [] } };
    seen.add(model.name);
    if (["AiChatMessage", "WaterAiChatMessage", "Notification"].includes(model.name))
      return { userId: user.id };
    if (model.name === "Report") {
      const rows = await this.prisma.report.findMany({ select: { id: true } });
      const ids: string[] = [];
      for (const row of rows) {
        try {
          await this.reports.loadReadable(row.id, user);
          ids.push(row.id);
        } catch (error) {
          if (
            error instanceof Error &&
            "getStatus" in error &&
            (error as { getStatus(): number }).getStatus() === 404
          )
            continue;
          throw error;
        }
      }
      return { id: { in: ids } };
    }
    if (model.name === "Document") {
      const result = await this.documents.findAll({}, user);
      const rows = Array.isArray(result) ? result : result.data;
      return { id: { in: rows.map((row) => row.id) } };
    }
    if (isAdminOrCeo(user)) return {};
    if (model.name.startsWith("Water")) {
      if (!user.roles.includes("water"))
        throw new ForbiddenException("Water records require Water access.");
      return {};
    }
    const codes = await viewerDepartmentCodes(user, this.prisma);
    const canDepartment = (code: string) => codes === null || codes.includes(code);
    if (model.name === "Project") return (await readableProjectsWhere(user, this.prisma)) as Where;
    if (model.name === "Task")
      return {
        OR: [{ assigneeId: user.id }, { project: await readableProjectsWhere(user, this.prisma) }],
      };
    if (model.name === "Client") {
      const billing = await billingViewerCodes(user, this.prisma);
      if (billing === null || billing.includes("operations") || billing.includes("tender"))
        return {};
      const department = { code: { in: billing } };
      return {
        OR: [
          { department },
          ...["contracts", "tenders", "clientRequests", "projects"].map((relation) => ({
            [relation]: { some: { department } },
          })),
        ],
      };
    }
    if (model.name === "Contract") return { department: { code: { in: codes ?? [] } } };
    if (["Tender", "ClientRequest"].includes(model.name))
      return canDepartment(model.name === "Tender" ? "tender" : "operations") ||
        (model.name === "ClientRequest" && canDepartment("tender"))
        ? {}
        : { department: { code: { in: codes ?? [] } } };
    if (model.name === "CalendarEvent")
      return {
        OR: [
          { visibility: "everyone" },
          { createdBy: user.id },
          { visibility: "department", departmentId: user.departmentId ?? "none" },
        ],
      };
    if (model.name === "PaymentLedgerEntry") {
      if (
        !(await hasResourceGrant(
          "payment-ledger",
          "3dd32195-341a-4ba2-9ef1-05e37a076bdd",
          user,
          "read",
          this.prisma,
        ))
      )
        throw new ForbiddenException("Payment ledger access is required.");
      return {};
    }
    if (model.name === "User") return canDepartment("hr") ? {} : { id: user.id };
    if (["Department", "Office"].includes(model.name)) return {};
    if (
      [
        "Lead",
        "Campaign",
        "BlogPost",
        "WebsiteAnalyticsSnapshot",
        "InventoryItem",
        "ItSystem",
        "Ticket",
        "HrmsLicense",
      ].includes(model.name)
    )
      return {};
    const groups: Record<string, string[]> = {
      finance: [
        "Invoice",
        "FinanceUpload",
        "FinanceReport",
        "Budget",
        "PayrollComplianceRecord",
        "Expense",
        "ServiceLine",
      ],
      hr: ["RecruitmentFunnel", "RecruitmentPlacement"],
      it: ["InventoryItem", "ItSystem", "Ticket", "HrmsLicense", "SystemUptimeRecord"],
      marketing: ["Lead", "Campaign", "BlogPost", "WebsiteAnalyticsSnapshot"],
    };
    for (const [code, names] of Object.entries(groups))
      if (names.includes(model.name)) {
        if (
          code === "finance"
            ? model.name === "Invoice"
              ? !userCan(user, "raise_invoices")
              : !user.roles.includes("finance")
            : !canDepartment(code)
        )
          throw new ForbiddenException(`${code} access is required for these records.`);
        return {};
      }
    for (const parent of [
      "Report",
      "Document",
      "Project",
      "Task",
      "Tender",
      "ClientRequest",
      "Contract",
      "Invoice",
      "FinanceReport",
      "Client",
      "ItSystem",
      "Ticket",
      "Campaign",
      "Lead",
    ]) {
      const relation = model.fields.find(
        (field) =>
          field.kind === "object" &&
          !field.isList &&
          field.type === parent &&
          field.relationFromFields?.length,
      );
      if (relation)
        return {
          [relation.name]: await this.scope(
            models.find((candidate) => candidate.name === parent)!,
            user,
            seen,
          ),
        };
    }
    throw new ForbiddenException("These records require administrator access.");
  }

  private href(model: string, row: Record<string, unknown>): string | null {
    const paths: Record<string, string> = {
      WaterCustomer: "/water/customers/",
      WaterMeter: "/water/meters/",
      Client: "/clients/",
      Project: "/projects/",
      Report: "/reports/",
      Invoice: "/finance/invoices/",
      Tender: "/tender/",
      ClientRequest: "/requests/",
      Document: "/documents/",
    };
    if (model === "Client") return `/clients?q=${encodeURIComponent(String(row.name ?? row.id))}`;
    if (model === "Invoice")
      return `/finance/invoices?q=${encodeURIComponent(String(row.invoiceNumber ?? row.id))}`;
    if (model === "Document") return "/documents";
    if (model === "Contract") return `/clients/contracts/${encodeURIComponent(String(row.id))}`;
    return paths[model] ? paths[model] + encodeURIComponent(String(row.id)) : null;
  }
}
