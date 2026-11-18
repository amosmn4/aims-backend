import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  parse,
  settingsSchema,
  type Collection,
  type Records,
  type Workspace,
} from "./ops.schemas";

export type OpsTransaction = Prisma.TransactionClient;
const optional = <T>(value: T | null): T | undefined => value ?? undefined;

@Injectable()
export class OpsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async load(
    db: OpsTransaction = this.prisma,
  ): Promise<{ workspace: Workspace; revision: number }> {
    const [
      state,
      departments,
      staff,
      clients,
      projects,
      tasks,
      reports,
      tenders,
      requests,
      businesses,
      finance,
      documents,
      records,
      templates,
      grants,
    ] = await Promise.all([
      db.opsState.findUniqueOrThrow({ where: { id: "workspace" } }),
      db.opsDepartment.findMany(),
      db.opsStaff.findMany({
        include: {
          moduleGrants: true,
          user: { select: { email: true, passwordHash: true, isActive: true } },
        },
      }),
      db.opsClient.findMany(),
      db.opsProject.findMany({ include: { members: true, departments: true } }),
      db.opsTask.findMany(),
      db.opsReport.findMany(),
      db.opsTender.findMany({ include: { members: true } }),
      db.opsClientRequest.findMany(),
      db.opsBusiness.findMany(),
      db.opsBusinessFinance.findMany(),
      db.opsDocument.findMany({ include: { grants: true } }),
      db.opsModuleRecord.findMany(),
      db.opsTemplate.findMany(),
      db.opsBusinessGrant.findMany(),
    ]);
    return {
      revision: state.revision,
      workspace: {
        version: 1,
        settings: parse(settingsSchema, state.settings),
        departments: departments.map((row) => ({
          ...row,
          id: row.id as Records["departments"]["id"],
          modules: row.modules as string[],
        })),
        people: staff.map((row) => ({
          id: row.id,
          name: row.name,
          title: row.title,
          dept: row.dept as Records["people"]["dept"],
        })),
        accounts: staff
          .filter((row) => row.user)
          .map((row) => ({
            id: row.id,
            personId: row.id,
            email: row.user!.email,
            role: row.role,
            active: row.active && row.user!.isActive,
            hasPassword: !!row.user!.passwordHash,
            modules: Object.fromEntries(
              row.moduleGrants.map((grant) => [grant.module, grant.access]),
            ),
          })),
        clients: clients.map((row) => ({
          ...row,
          services: row.services as string[],
          assignees: (row.assignees as string[] | null) ?? [],
          assignedDept: optional(row.assignedDept),
        })),
        projects: projects.map(({ departments: depts, members, client, ...row }) => ({
          ...row,
          client: optional(client),
          status: row.status as Records["projects"]["status"],
          stage: row.stage as Records["projects"]["stage"],
          depts: depts.map((dept) => dept.deptId as Records["departments"]["id"]),
          members: members.map((member) => member.personId),
        })),
        tasks: tasks.map((row) => ({
          ...row,
          project: row.project ?? "",
          weekStart: optional(row.weekStart),
          source: row.source as Records["tasks"]["source"],
          subtasks: (row.subtasks as Records["tasks"]["subtasks"]) ?? [],
          status: row.status as Records["tasks"]["status"],
          priority: row.priority as Records["tasks"]["priority"],
          description: optional(row.description),
          ceoComment: optional(row.ceoComment),
        })),
        reports: reports.map((row) => ({
          ...row,
          type: row.type as Records["reports"]["type"],
          dept: row.dept as Records["reports"]["dept"],
          project: optional(row.project),
          progress: optional(row.progress),
          blockers: optional(row.blockers),
          next: optional(row.next),
          comment: optional(row.comment),
          month: optional(row.month),
          status: row.status as Records["reports"]["status"],
          taskIds: (row.taskIds as string[] | null) ?? [],
          attachments: (row.attachments as string[] | null) ?? [],
          taskSnapshots: (row.taskSnapshots as Records["reports"]["taskSnapshots"]) ?? [],
          leaveSnapshot: (row.leaveSnapshot as Records["reports"]["leaveSnapshot"]) ?? [],
        })),
        tenders: tenders.map(({ members, ...row }) => ({
          ...row,
          stage: row.stage as Records["tenders"]["stage"],
          value: Number(row.value),
          notes: optional(row.notes),
          members: members.map((member) => member.personId),
        })),
        clientRequests: requests.map((row) => ({
          ...row,
          client: optional(row.client),
          prospectClientName: optional(row.prospectClientName),
          source: row.source as Records["clientRequests"]["source"],
          status: row.status as Records["clientRequests"]["status"],
          notes: optional(row.notes),
          assignedDept: optional(row.assignedDept),
        })),
        businesses,
        businessFinance: finance.map((row) => ({
          ...row,
          revenue: Number(row.revenue),
          expenses: Number(row.expenses),
          description: row.description,
          note: optional(row.note),
        })),
        businessAccess: grants
          .filter((row) => row.kind !== "home")
          .filter(
            (row, index, rows) =>
              rows.findIndex(
                (item) => item.personId === row.personId && item.businessId === row.businessId,
              ) === index,
          )
          .map((row) => ({
            person: row.personId,
            business: row.businessId,
            manage: grants.some(
              (item) =>
                item.personId === row.personId &&
                item.businessId === row.businessId &&
                item.kind === "manage",
            ),
            finance: grants.some(
              (item) =>
                item.personId === row.personId &&
                item.businessId === row.businessId &&
                item.kind === "fin_manage",
            )
              ? ("manage" as const)
              : grants.some(
                    (item) =>
                      item.personId === row.personId &&
                      item.businessId === row.businessId &&
                      item.kind === "fin_view",
                  )
                ? ("view" as const)
                : undefined,
          })),
        staffBusiness: grants
          .filter((row) => row.kind === "home")
          .map((row) => ({ person: row.personId, business: row.businessId })),
        documents: documents.map((row) => ({
          id: row.id,
          name: row.name,
          folder: row.folder,
          access: row.access as Records["documents"]["access"],
          owner: row.owner,
          updated: row.updated,
          project: optional(row.project),
          task: optional(row.task),
          weeklyRef: optional(row.weeklyRef),
          report: optional(row.report),
          version: row.version,
          dept: optional(row.dept) as Records["documents"]["dept"],
          allowed: row.grants.map((grant) => grant.personId),
          fileKey: row.id,
          mime: row.mime,
        })),
        moduleRecords: records.map((row) => ({
          ...row,
          dept: row.dept as Records["moduleRecords"]["dept"],
          status: row.status as Records["moduleRecords"]["status"],
          amount: row.amount === null ? undefined : Number(row.amount),
        })),
        templates,
      },
    };
  }

  async save<K extends Collection>(db: OpsTransaction, collection: K, record: Records[K]) {
    switch (collection) {
      case "departments": {
        const row = record as Records["departments"];
        return db.opsDepartment.upsert({
          where: { id: row.id },
          create: row,
          update: row,
        });
      }
      case "people": {
        const row = record as Records["people"];
        return db.opsStaff.upsert({ where: { id: row.id }, create: row, update: row });
      }
      case "clients": {
        const row = record as Records["clients"];
        const data = {
          ...row,
          assignees: row.assignees ?? [],
          assignedDept: row.assignedDept ?? null,
        };
        return db.opsClient.upsert({ where: { id: row.id }, create: data, update: data });
      }
      case "projects": {
        const { members, depts, ...row } = record as Records["projects"];
        const data = { ...row, client: row.client ?? null };
        await db.opsProject.upsert({ where: { id: row.id }, create: data, update: data });
        await db.opsProjectMember.deleteMany({ where: { projectId: row.id } });
        await db.opsProjectDepartment.deleteMany({ where: { projectId: row.id } });
        await db.opsProjectMember.createMany({
          data: members.map((personId) => ({ projectId: row.id, personId })),
        });
        return db.opsProjectDepartment.createMany({
          data: [...new Set(depts)].map((deptId) => ({ projectId: row.id, deptId })),
        });
      }
      case "tasks": {
        const row = record as Records["tasks"];
        const data = {
          ...row,
          project: row.project || null,
          weekStart: row.weekStart ?? null,
          subtasks: row.subtasks ?? [],
        };
        return db.opsTask.upsert({ where: { id: row.id }, create: data, update: data });
      }
      case "reports": {
        const row = record as Records["reports"];
        const data = {
          ...row,
          project: row.project ?? null,
          progress: row.progress ?? null,
          blockers: row.blockers ?? null,
          next: row.next ?? null,
          comment: row.comment ?? null,
          taskIds: row.taskIds ?? [],
          attachments: row.attachments ?? [],
          taskSnapshots: JSON.parse(JSON.stringify(row.taskSnapshots ?? [])),
          leaveSnapshot: JSON.parse(JSON.stringify(row.leaveSnapshot ?? [])),
        };
        return db.opsReport.upsert({ where: { id: row.id }, create: data, update: data });
      }
      case "tenders": {
        const { members, ...row } = record as Records["tenders"];
        const data = { ...row, notes: row.notes ?? null };
        await db.opsTender.upsert({ where: { id: row.id }, create: data, update: data });
        await db.opsTenderMember.deleteMany({ where: { tenderId: row.id } });
        return db.opsTenderMember.createMany({
          data: members.map((personId) => ({ tenderId: row.id, personId })),
        });
      }
      case "clientRequests": {
        const row = record as Records["clientRequests"];
        const data = {
          ...row,
          client: row.client ?? null,
          prospectClientName: row.prospectClientName ?? null,
          assignedDept: row.assignedDept ?? null,
          notes: row.notes ?? null,
        };
        return db.opsClientRequest.upsert({ where: { id: row.id }, create: data, update: data });
      }
      case "businesses": {
        const row = record as Records["businesses"];
        return db.opsBusiness.upsert({ where: { id: row.id }, create: row, update: row });
      }
      case "businessFinance": {
        const row = record as Records["businessFinance"];
        const data = {
          ...row,
          revenue: new Prisma.Decimal(row.revenue.toFixed(2)),
          expenses: new Prisma.Decimal(row.expenses.toFixed(2)),
          description: row.description,
          note: row.note ?? null,
        };
        return db.opsBusinessFinance.upsert({ where: { id: row.id }, create: data, update: data });
      }
      case "moduleRecords": {
        const row = record as Records["moduleRecords"];
        const data = {
          ...row,
          amount: row.amount === undefined ? null : new Prisma.Decimal(row.amount.toFixed(2)),
        };
        return db.opsModuleRecord.upsert({ where: { id: row.id }, create: data, update: data });
      }
      case "templates": {
        const row = record as Records["templates"];
        return db.opsTemplate.upsert({ where: { id: row.id }, create: row, update: row });
      }
      case "documents": {
        const {
          allowed,
          fileKey: _fileKey,
          mime: _mime,
          sample: _sample,
          version: _version,
          ...row
        } = record as Records["documents"];
        await db.opsDocument.update({
          where: { id: row.id },
          data: { ...row, project: row.project ?? null, dept: row.dept ?? null },
        });
        await db.opsDocumentGrant.deleteMany({ where: { documentId: row.id } });
        if (row.access === "restricted" && allowed?.length)
          await db.opsDocumentGrant.createMany({
            data: allowed.map((personId) => ({ documentId: row.id, personId })),
          });
      }
    }
  }

  async remove(db: OpsTransaction, collection: Collection, id: string) {
    switch (collection) {
      case "people":
        return db.opsStaff.delete({ where: { id } });
      case "clients":
        return db.opsClient.delete({ where: { id } });
      case "projects":
        return db.opsProject.delete({ where: { id } });
      case "tasks":
        return db.opsTask.delete({ where: { id } });
      case "reports":
        return db.opsReport.delete({ where: { id } });
      case "tenders":
        return db.opsTender.delete({ where: { id } });
      case "clientRequests":
        return db.opsClientRequest.delete({ where: { id } });
      case "businesses":
        return db.opsBusiness.delete({ where: { id } });
      case "businessFinance":
        return db.opsBusinessFinance.delete({ where: { id } });
      case "documents":
        return db.opsDocument.delete({ where: { id } });
      case "moduleRecords":
        return db.opsModuleRecord.delete({ where: { id } });
      case "templates":
        return db.opsTemplate.delete({ where: { id } });
      case "departments":
        throw new Error("Departments cannot be deleted.");
    }
  }
}
