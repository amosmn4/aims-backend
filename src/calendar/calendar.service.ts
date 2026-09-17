import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AppRole, Prisma, TenderStage } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import { viewerDepartmentCodes } from "../common/department-scope";
import { maskUserRef } from "../common/mask-user-ref";
import { DEPARTMENT_ROLES, userCan } from "../common/capabilities";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { CreateCalendarEventDto, UpdateCalendarEventDto } from "./dto/calendar-event.dto";

export type DeadlineType =
  | "tender_submission"
  | "bond_expiry"
  | "contract_renewal"
  | "task_due"
  | "event"
  | "milestone"
  | "payroll_filing"
  | "report_due"
  | "training";

export interface DeadlineItem {
  date: string;
  type: DeadlineType;
  title: string;
  to: string;
  eventId?: string;
}

const OPEN_TENDER_STAGES: TenderStage[] = ["identified", "applying", "submitted"];
const USER_REF = {
  id: true,
  fullName: true,
  email: true,
  roles: { select: { role: true } },
} as const;
const HOME_SCOPED: AppRole[] = ["department_head", "account_manager", "general_staff"];
const day = (d: Date) => d.toISOString().slice(0, 10);

// Reads dates that already live on tenders, contracts, tasks, milestones and filings, plus calendar events.
@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  // CEO sees the company calendar; everyone else sees their own tasks, contracts and department dates.
  // Tender deadlines only show to the Tender team, who run the bids.
  async listDeadlines(
    from: Date,
    to: Date,
    departmentId: string | undefined,
    viewer: AuthenticatedUser,
  ): Promise<DeadlineItem[]> {
    const admin = isAdminOrCeo(viewer);
    const mine = !admin;
    const seesTenderPipeline = admin || viewer.roles.includes("tender");
    const seesPayroll = admin || viewer.roles.includes("finance");
    const projectWhere = {
      ...(await this.visibleProjectWhere(viewer)),
      ...(departmentId && { departmentId }),
    };

    const [tenders, bonds, contracts, tasks, events, milestones, filings, trainings, settings] =
      await Promise.all([
        seesTenderPipeline
          ? this.prisma.tender.findMany({
              where: {
                stage: { in: OPEN_TENDER_STAGES },
                submissionDeadline: { gte: from, lte: to },
                ...(departmentId && { departmentId }),
                ...(mine && { accountManagerId: viewer.id }),
              },
              select: { id: true, title: true, submissionDeadline: true },
            })
          : Promise.resolve([]),
        seesTenderPipeline
          ? this.prisma.tenderBond.findMany({
              where: {
                expiryDate: { gte: from, lte: to },
                ...(departmentId && { tender: { departmentId } }),
                ...(mine && { tender: { accountManagerId: viewer.id } }),
              },
              select: {
                id: true,
                expiryDate: true,
                bondType: true,
                tender: { select: { id: true, title: true } },
              },
            })
          : Promise.resolve([]),
        this.prisma.contract.findMany({
          where: {
            status: "active",
            endDate: { gte: from, lte: to },
            ...(departmentId && { departmentId }),
            ...(mine && { accountManagerId: viewer.id }),
          },
          select: { id: true, title: true, endDate: true },
        }),
        this.prisma.task.findMany({
          where: {
            status: { not: "completed" },
            dueDate: { gte: from, lte: to },
            ...(departmentId && { project: { departmentId } }),
            ...(mine && { assigneeId: viewer.id }),
          },
          select: { id: true, title: true, dueDate: true, projectId: true },
        }),
        this.prisma.calendarEvent.findMany({
          where: {
            AND: [
              await this.eventWhere(viewer),
              this.rangeWhere(from, to),
              departmentId ? { OR: [{ departmentId }, { departmentId: null }] } : {},
            ],
          },
          select: { id: true, title: true, startsAt: true },
        }),
        this.prisma.milestone.findMany({
          where: { isComplete: false, dueDate: { gte: from, lte: to }, project: projectWhere },
          select: {
            id: true,
            title: true,
            dueDate: true,
            project: { select: { id: true, name: true } },
          },
        }),
        seesPayroll
          ? this.prisma.payrollComplianceRecord.findMany({
              where: { status: { in: ["pending", "overdue"] }, dueDate: { gte: from, lte: to } },
              select: {
                id: true,
                filingType: true,
                dueDate: true,
                client: { select: { name: true } },
              },
            })
          : Promise.resolve([]),
        this.prisma.project.findMany({
          where: {
            ...projectWhere,
            serviceLine: { code: "TRAINING" },
            status: { not: "cancelled" },
            startDate: { gte: from, lte: to },
          },
          select: { id: true, name: true, startDate: true },
        }),
        this.prisma.companySettings.findUnique({
          where: { id: "company" },
          select: { reportDueDay: true },
        }),
      ]);

    const items: DeadlineItem[] = [];
    for (const t of tenders) {
      if (!t.submissionDeadline) continue;
      items.push({
        date: day(t.submissionDeadline),
        type: "tender_submission",
        title: `Tender submission: ${t.title}`,
        to: `/tender/${t.id}`,
      });
    }
    for (const b of bonds) {
      if (!b.expiryDate) continue;
      items.push({
        date: day(b.expiryDate),
        type: "bond_expiry",
        title: `Bond expiry (${b.bondType}): ${b.tender.title}`,
        to: `/tender/${b.tender.id}`,
      });
    }
    for (const c of contracts) {
      if (!c.endDate) continue;
      items.push({
        date: day(c.endDate),
        type: "contract_renewal",
        title: `Contract renewal: ${c.title}`,
        to: `/clients/contracts/${c.id}`,
      });
    }
    for (const task of tasks) {
      if (!task.dueDate) continue;
      items.push({
        date: day(task.dueDate),
        type: "task_due",
        title: `Task due: ${task.title}`,
        to: `/projects/${task.projectId}`,
      });
    }
    for (const e of events) {
      items.push({
        date: day(e.startsAt),
        type: "event",
        title: e.title,
        to: "/calendar",
        eventId: e.id,
      });
    }
    for (const m of milestones) {
      items.push({
        date: day(m.dueDate),
        type: "milestone",
        title: `Milestone: ${m.title} (${m.project.name})`,
        to: `/projects/${m.project.id}`,
      });
    }
    for (const f of filings) {
      items.push({
        date: day(f.dueDate),
        type: "payroll_filing",
        title: `Payroll filing due: ${f.filingType} for ${f.client.name}`,
        to: "/finance/payroll-compliance",
      });
    }
    for (const p of trainings) {
      if (!p.startDate) continue;
      items.push({
        date: day(p.startDate),
        type: "training",
        title: `Training starts: ${p.name}`,
        to: `/projects/${p.id}`,
      });
    }
    items.push(
      ...(await this.reportDueItems(from, to, settings?.reportDueDay ?? 5, departmentId, viewer)),
    );

    items.sort((a, b) => a.date.localeCompare(b.date));
    return items;
  }

  async listEvents(from: Date, to: Date, viewer: AuthenticatedUser) {
    const rows = await this.prisma.calendarEvent.findMany({
      where: { AND: [await this.eventWhere(viewer), this.rangeWhere(from, to)] },
      include: {
        department: { select: { id: true, name: true, code: true } },
        creator: { select: USER_REF },
      },
      orderBy: { startsAt: "asc" },
    });
    return rows.map((e) => this.present(e, viewer));
  }

  async createEvent(dto: CreateCalendarEventDto, viewer: AuthenticatedUser) {
    const visibility = dto.visibility ?? "department";
    const departmentId =
      dto.departmentId ?? (visibility === "department" ? viewer.departmentId : null);
    await this.assertEventRules(visibility, departmentId, dto.startsAt, dto.endsAt, viewer);
    const created = await this.prisma.calendarEvent.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        location: dto.location?.trim() || null,
        startsAt: new Date(dto.startsAt),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        allDay: dto.allDay ?? true,
        departmentId,
        visibility,
        createdBy: viewer.id,
      },
      include: {
        department: { select: { id: true, name: true, code: true } },
        creator: { select: USER_REF },
      },
    });
    return this.present(created, viewer);
  }

  async updateEvent(id: string, dto: UpdateCalendarEventDto, viewer: AuthenticatedUser) {
    const event = await this.editableEvent(id, viewer);
    const visibility = dto.visibility ?? event.visibility;
    const departmentId = dto.departmentId === undefined ? event.departmentId : dto.departmentId;
    const startsAt = dto.startsAt ?? event.startsAt.toISOString();
    const endsAt = dto.endsAt === undefined ? event.endsAt?.toISOString() : dto.endsAt;
    await this.assertEventRules(visibility, departmentId, startsAt, endsAt, viewer);
    const updated = await this.prisma.calendarEvent.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        location: dto.location === undefined ? undefined : dto.location.trim() || null,
        startsAt: new Date(startsAt),
        endsAt: endsAt ? new Date(endsAt) : null,
        allDay: dto.allDay,
        departmentId,
        visibility,
      },
      include: {
        department: { select: { id: true, name: true, code: true } },
        creator: { select: USER_REF },
      },
    });
    return this.present(updated, viewer);
  }

  async removeEvent(id: string, viewer: AuthenticatedUser) {
    await this.editableEvent(id, viewer);
    await this.prisma.calendarEvent.delete({ where: { id } });
    return { id };
  }

  private present<
    T extends {
      createdBy: string;
      creator: { id: string; fullName: string | null; email: string; roles: { role: AppRole }[] };
    },
  >(event: T, viewer: AuthenticatedUser) {
    return {
      ...event,
      creator: maskUserRef(event.creator, viewer),
      canEdit: event.createdBy === viewer.id || isAdminOrCeo(viewer),
    };
  }

  private async editableEvent(id: string, viewer: AuthenticatedUser) {
    const event = await this.prisma.calendarEvent.findFirst({
      where: { AND: [{ id }, await this.eventWhere(viewer)] },
    });
    if (!event) throw new NotFoundException("Event not found");
    if (event.createdBy !== viewer.id && !isAdminOrCeo(viewer)) {
      throw new ForbiddenException("Only the person who added this event can change it");
    }
    return event;
  }

  private async assertEventRules(
    visibility: string,
    departmentId: string | null | undefined,
    startsAt: string,
    endsAt: string | null | undefined,
    viewer: AuthenticatedUser,
  ) {
    if (endsAt && new Date(endsAt) < new Date(startsAt)) {
      throw new BadRequestException("The event must end after it starts");
    }
    if (visibility === "department" && !departmentId) {
      throw new BadRequestException("Choose which department should see this event");
    }
    if (visibility === "everyone" && !userCan(viewer, "edit_department")) {
      throw new ForbiddenException("Only department leads can add events for the whole company");
    }
    if (departmentId && !isAdminOrCeo(viewer)) {
      const [codes, department] = await Promise.all([
        viewerDepartmentCodes(viewer, this.prisma),
        this.prisma.department.findUnique({ where: { id: departmentId }, select: { code: true } }),
      ]);
      if (!department || (codes && !codes.includes(department.code))) {
        throw new ForbiddenException("You can only add events for your own department");
      }
    }
  }

  private rangeWhere(from: Date, to: Date): Prisma.CalendarEventWhereInput {
    return {
      startsAt: { lte: to },
      OR: [{ startsAt: { gte: from } }, { endsAt: { gte: from } }],
    };
  }

  private async eventWhere(viewer: AuthenticatedUser): Promise<Prisma.CalendarEventWhereInput> {
    if (isAdminOrCeo(viewer))
      return { OR: [{ visibility: { not: "private" } }, { createdBy: viewer.id }] };
    const codes = await viewerDepartmentCodes(viewer, this.prisma);
    return {
      OR: [
        { visibility: "everyone" },
        { createdBy: viewer.id },
        { visibility: "department", department: { code: { in: codes ?? [] } } },
      ],
    };
  }

  private async visibleProjectWhere(viewer: AuthenticatedUser): Promise<Prisma.ProjectWhereInput> {
    const codes = await viewerDepartmentCodes(viewer, this.prisma);
    if (codes === null) return {};
    return {
      department: { code: { in: codes } },
      OR: [
        { visibility: "department" },
        { createdBy: viewer.id },
        { team: { some: { userId: viewer.id } } },
      ],
    };
  }

  private async reportDueItems(
    from: Date,
    to: Date,
    dueDay: number,
    departmentId: string | undefined,
    viewer: AuthenticatedUser,
  ): Promise<DeadlineItem[]> {
    const admin = isAdminOrCeo(viewer);
    let departments: { name: string; code: string }[] = [];
    if (!admin) {
      const home =
        viewer.departmentId && viewer.roles.some((r) => HOME_SCOPED.includes(r))
          ? viewer.departmentId
          : null;
      const rows = await this.prisma.department.findMany({
        where: {
          OR: [
            {
              code: {
                in: viewer.roles.filter((r) => (DEPARTMENT_ROLES as readonly string[]).includes(r)),
              },
            },
            ...(home ? [{ id: home }] : []),
          ],
          ...(departmentId && { id: departmentId }),
        },
        select: { id: true, name: true, code: true },
      });
      departments = rows.filter((d) => userCan(viewer, "submit_reports", d));
      if (departments.length === 0) return [];
    }
    const items: DeadlineItem[] = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), dueDay));
    while (cursor <= to) {
      if (cursor >= from) {
        const date = day(cursor);
        if (admin)
          items.push({ date, type: "report_due", title: "Department reports due", to: "/reports" });
        for (const d of departments) {
          items.push({
            date,
            type: "report_due",
            title: `Monthly report due: ${d.name}`,
            to: `/${d.code}/reports`,
          });
        }
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return items;
  }
}
