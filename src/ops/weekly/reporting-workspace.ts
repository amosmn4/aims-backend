import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { PrismaService } from "../../prisma/prisma.service";
import { parse, type Viewer } from "../ops.schemas";
import { addDays, nairobiDate, scheduleFor, weekOf } from "./weekly-calendar";
import { weeklyDate, weeklySubmissionSchema } from "./weekly.schemas";
import type { WeeklyService } from "./weekly.service";

export async function reportingWorkspace(
  db: PrismaService,
  weekly: WeeklyService,
  viewer: Viewer,
  query: Record<string, string>,
  now: Date,
) {
  if (!["staff", "ceo"].includes(viewer.role))
    throw new ForbiddenException("A reporting account is required.");
  const dto = parse(
    z
      .object({
        view: z
          .enum(["overview", "submissions", "plans", "reports", "performance"])
          .default("submissions"),
        from: weeklyDate.optional(),
        to: weeklyDate.optional(),
        type: z.enum(["", "plan", "report", "monthly"]).default(""),
        status: z
          .enum(["", "submitted", "reviewed", "returned", "recalled", "draft", "new", "scheduled"])
          .default(""),
        department: z.string().max(36).default(""),
        staff: z.string().uuid().optional(),
        search: z.string().trim().max(200).default(""),
        page: z.coerce.number().int().min(1).max(100000).default(1),
      })
      .strict(),
    query,
  );
  if (viewer.role !== "ceo" && ["overview", "plans", "reports", "performance"].includes(dto.view))
    throw new ForbiddenException("CEO access is required.");
  const from = dto.from ?? weekOf(nairobiDate(now));
  const to = dto.to ?? addDays(from, 6);
  if (
    from > to ||
    new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime() > 366 * 86400000
  )
    throw new BadRequestException("Choose a date range of up to one year.");
  const ceo = viewer.role === "ceo";
  const schedule = await weekly.settings();
  const profiles = await db.opsStaff.findMany({
    where: ceo ? { role: "staff" } : { id: viewer.id },
    include: { user: { select: { isActive: true, passwordHash: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const ids = profiles.map((person) => person.id);
  const [records, monthly, schedules, tasks] = await Promise.all([
    db.opsWeeklyReport.findMany({
      where: { staffId: { in: ids }, weekStart: { gte: weekOf(from), lte: to } },
      orderBy: [{ weekStart: "desc" }, { id: "asc" }],
    }),
    db.opsReport.findMany({
      where: {
        author: { in: ids },
        date: { gte: from, lte: to },
        ...(ceo ? { status: { not: "draft" } } : {}),
      },
      orderBy: [{ date: "desc" }, { id: "asc" }],
    }),
    db.opsSubmissionSchedule.findMany({ where: { staffId: { in: ids }, status: "pending" } }),
    db.opsTask.findMany({
      where: {
        assignee: { in: ids },
        OR: [
          { weekStart: { gte: weekOf(from), lte: to } },
          { weekStart: null, due: { gte: from, lte: to } },
        ],
      },
      select: { id: true, assignee: true, status: true, weekStart: true, due: true },
    }),
  ]);
  const events = await db.auditLog.findMany({
    where: {
      entityType: "ops-weekly",
      entityId: { in: records.map((row) => row.id) },
      action: {
        in: [
          "ops.weekly.submitted",
          "ops.weekly.revised",
          "ops.weekly.tasks_added",
          "ops.weekly.reviewed",
          "ops.weekly.returned",
          "ops.weekly.recalled",
          ...(!ceo ? ["ops.weekly.draft_saved"] : []),
        ],
      },
    },
    select: { id: true, entityId: true, action: true, newValue: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const submittedEvents = (id: string) =>
    events.filter(
      (event) =>
        event.entityId === id &&
        ["ops.weekly.submitted", "ops.weekly.revised", "ops.weekly.tasks_added"].includes(
          event.action,
        ),
    );
  const rows = records.flatMap((record) => {
    const person = profiles.find((profile) => profile.id === record.staffId)!;
    const history = submittedEvents(record.id);
    if (ceo && !record.submittedAt && !history.length) return [];
    const latest = history[0];
    const previous = latest?.newValue as { submission?: unknown } | null;
    const snapshot = ceo && !record.submittedAt ? previous?.submission : record.submission;
    if (!snapshot) return [];
    const entry = weekly.serialize(
      { ...record, submission: snapshot as Prisma.JsonValue },
      schedule.settings,
    )!;
    const status = record.reviewedAt
      ? "reviewed"
      : record.submittedAt
        ? "submitted"
        : record.returnedAt
          ? "returned"
          : record.recalledAt
            ? "recalled"
            : "draft";
    const scheduled = schedules.find(
      (item) =>
        item.staffId === record.staffId &&
        item.kind === record.phase &&
        item.target === record.weekStart,
    );
    const row = {
      id: record.id,
      staffId: person.id,
      name: person.name,
      dept: person.dept,
      type: record.phase as "plan" | "report" | "monthly",
      period: record.weekStart,
      date: (record.submittedAt
        ? (latest?.createdAt ?? record.submittedAt)
        : record.updatedAt
      ).toISOString(),
      status: scheduled ? "scheduled" : status,
      title: entry.submission.title || `Weekly ${record.phase}`,
      summary: entry.submission.summary,
      taskCount: entry.submission.items.length,
      updates: Math.max(0, history.length - 1),
      entry,
      historical: !record.submittedAt && ceo,
      scheduledAt: scheduled?.runAt.toISOString() ?? null,
      event:
        history.length > 1
          ? `${record.phase === "plan" ? "Plan" : "Report"} update`
          : `Weekly ${record.phase}`,
    };
    return [row];
  });
  const monthlyRows = monthly.map((record) => {
    const person = profiles.find((profile) => profile.id === record.author)!;
    const tasks = Array.isArray(record.taskSnapshots) ? record.taskSnapshots : [];
    const scheduled = schedules.find(
      (item) =>
        item.staffId === record.author && item.kind === "monthly" && item.target === record.id,
    );
    return {
      id: record.id,
      staffId: person.id,
      name: person.name,
      dept: person.dept,
      type: "monthly" as const,
      period: record.month ?? record.date.slice(0, 7),
      date: `${record.date}T12:00:00+03:00`,
      status: scheduled
        ? "scheduled"
        : record.status === "draft"
          ? "draft"
          : record.reviewed
            ? "reviewed"
            : "submitted",
      title: record.title,
      summary: record.progress ?? "",
      taskCount: tasks.length,
      updates: 0,
      entry: null,
      historical: false,
      scheduledAt: scheduled?.runAt.toISOString() ?? null,
      event: record.type === "Ad hoc" ? "Ad hoc report" : "Monthly report",
    };
  });
  const matchesPerson = (person: { id: string; name: string; dept: string | null }) =>
    (!ceo || !dto.department || person.dept === dto.department) &&
    (!ceo || !dto.staff || person.id === dto.staff);
  const matches = (row: {
    staffId: string;
    name: string;
    dept: string | null;
    type: string;
    status: string;
    historical: boolean;
    title: string;
    summary: string;
  }) =>
    matchesPerson({ id: row.staffId, name: row.name, dept: row.dept }) &&
    (!dto.type || dto.type === row.type) &&
    (!dto.status ||
      (dto.status === "new"
        ? row.status === "submitted" && !row.historical
        : row.status === dto.status)) &&
    `${row.name} ${row.title} ${row.summary}`.toLowerCase().includes(dto.search.toLowerCase());
  const filtered = [...rows, ...monthlyRows]
    .filter(
      (row) =>
        (dto.view !== "overview" || row.status === "submitted") &&
        (dto.view !== "plans" || row.type === "plan") &&
        (dto.view !== "reports" || row.type !== "plan") &&
        matches(row),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const people = profiles.filter(matchesPerson);
  const selected = records.filter((record) =>
    people.some((person) => person.id === record.staffId),
  );
  const expected = (person: (typeof profiles)[number], phase: "plan" | "report") => {
    let count = 0;
    for (let week = weekOf(from); week <= to; week = addDays(week, 7))
      if (
        (person.active &&
          person.user?.isActive &&
          person.user.passwordHash &&
          week >= schedule.settings.startWeek &&
          person.createdAt <= scheduleFor(week, phase, schedule.settings).deadline) ||
        selected.some(
          (row) =>
            row.staffId === person.id &&
            row.phase === phase &&
            row.weekStart === week &&
            row.submittedAt,
        )
      )
        count++;
    return count;
  };
  const performance = people
    .filter((person) => person.name.toLowerCase().includes(dto.search.toLowerCase()))
    .map((person) => {
      const own = selected.filter((row) => row.staffId === person.id);
      const plans = own.filter((row) => row.phase === "plan" && row.submittedAt).length;
      const reports = own.filter((row) => row.phase === "report" && row.submittedAt);
      const reported = reports.flatMap((row) =>
        parse(weeklySubmissionSchema, row.submission).items.map((item) => ({
          id: item.taskId ?? item.id,
          status: item.status,
        })),
      );
      const live = tasks
        .filter(
          (task) =>
            task.assignee === person.id &&
            !reports.some((report) => report.weekStart === (task.weekStart ?? weekOf(task.due))),
        )
        .map((task) => ({
          id: task.id,
          status:
            task.status === "Done"
              ? "completed"
              : task.status === "In progress"
                ? "in_progress"
                : "pending",
        }));
      const items = [...new Map([...live, ...reported].map((item) => [item.id, item])).values()];
      const completed = items.filter((item) => item.status === "completed").length;
      const activity = own.reduce<string | null>(
        (date, row) =>
          !date || row.updatedAt.toISOString() > date ? row.updatedAt.toISOString() : date,
        null,
      );
      return {
        id: person.id,
        name: person.name,
        dept: person.dept,
        plans,
        reports: reports.length,
        expectedPlans: expected(person, "plan"),
        expectedReports: expected(person, "report"),
        tasks: items.length,
        completed,
        completion: items.length ? Math.round((completed / items.length) * 100) : 0,
        activity,
      };
    });
  const currentRows = rows.filter(
    (row) => !row.historical || records.some((record) => record.id === row.id),
  );
  const metrics = {
    tasks: tasks.filter((task) => people.some((person) => person.id === task.assignee)).length,
    completed: tasks.filter(
      (task) => task.status === "Done" && people.some((person) => person.id === task.assignee),
    ).length,
    staff: people.filter(
      (person) => person.active && person.user?.isActive && person.user.passwordHash,
    ).length,
    plans: selected.filter((row) => row.phase === "plan" && row.submittedAt).length,
    reports: selected.filter((row) => row.phase === "report" && row.submittedAt).length,
    awaiting:
      currentRows.filter(
        (row) => row.status === "submitted" && people.some((person) => person.id === row.staffId),
      ).length +
      monthlyRows.filter(
        (row) =>
          row.status === "submitted" &&
          matchesPerson({ id: row.staffId, name: row.name, dept: row.dept }),
      ).length,
    expectedPlans: people.reduce((sum, person) => sum + expected(person, "plan"), 0),
    expectedReports: people.reduce((sum, person) => sum + expected(person, "report"), 0),
    overdueReports: people.reduce((sum, person) => {
      let missing = 0;
      for (let week = weekOf(from); week <= to; week = addDays(week, 7)) {
        const deadline = scheduleFor(week, "report", schedule.settings).deadline;
        if (
          week >= schedule.settings.startWeek &&
          person.active &&
          person.user?.isActive &&
          person.user.passwordHash &&
          person.createdAt <= deadline &&
          deadline < now &&
          !selected.some(
            (row) =>
              row.staffId === person.id &&
              row.weekStart === week &&
              row.phase === "report" &&
              row.submittedAt,
          )
        )
          missing++;
      }
      return sum + missing;
    }, 0),
  };
  const total = dto.view === "performance" ? performance.length : filtered.length;
  const page = Math.min(dto.page, Math.max(1, Math.ceil(total / 10)));
  const start = (page - 1) * 10;
  const activity = events
    .filter((event) => {
      const row = records.find((record) => record.id === event.entityId);
      return !!row && people.some((person) => person.id === row.staffId);
    })
    .slice(0, 8)
    .map((event) => {
      const row = records.find((record) => record.id === event.entityId)!;
      return {
        id: event.id,
        action: event.action.replace("ops.weekly.", "").replaceAll("_", " "),
        date: event.createdAt.toISOString(),
        staffId: row.staffId,
        name: profiles.find((person) => person.id === row.staffId)!.name,
        week: row.weekStart,
        phase: row.phase,
      };
    });
  return {
    from,
    to,
    now: now.toISOString(),
    rows: filtered.slice(start, start + 10),
    performance: performance.slice(start, start + 10),
    total,
    page,
    limit: 10,
    metrics,
    activity,
  };
}
