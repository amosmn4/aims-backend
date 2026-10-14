import { describe, expect, it, jest } from "@jest/globals";
import { ReportsService } from "./reports.service";
import { aimsFigure } from "./report-figures";
import type { ReportContent, ReportContentService } from "./report-content.service";
import type { ReportAccessService } from "./report-access.service";
import type { ReportNotifierService } from "./report-notifier.service";
import { readSections, type ReportSection } from "./report-sections";
import type { PrismaService } from "../prisma/prisma.service";
import type { DocumentsService } from "../documents/documents.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { Prisma, type ReportStatus, type ReportTemplate } from "@prisma/client";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";

const user: AuthenticatedUser = {
  id: "author",
  email: "author@example.test",
  roles: ["hr"],
  departmentId: "hr",
};
const update = {
  text: "Client recruitment: Sent the shortlist",
  source: "aims" as const,
  link: "/projects/recruitment?view=discussions",
  when: "2026-09-30",
};

describe("report list scope", () => {
  function listFixture() {
    const prisma = {
      department: { findMany: jest.fn(async () => [{ id: "hr", code: "hr" }]) },
      userPermissionOverride: { findMany: jest.fn(async () => []) },
      project: { findMany: jest.fn(async (_query: unknown) => [{ id: "invited-project" }]) },
      resourceAccessGrant: { findMany: jest.fn(async () => []) },
      report: { findMany: jest.fn(async (_query: unknown) => []) },
    };
    const service = new ReportsService(
      prisma as unknown as PrismaService,
      {} as DocumentsService,
      {} as ReportNotifierService,
      { sharedDepartmentIds: jest.fn(async () => ["hr"]) } as unknown as ReportAccessService,
      {} as ReportContentService,
    );
    return { prisma, service };
  }

  it("refuses an ordinary member's review-queue request", async () => {
    const { service, prisma } = listFixture();
    await expect(service.list(user, { forReview: true })).rejects.toThrow(ForbiddenException);
    expect(prisma.report.findMany).not.toHaveBeenCalled();
  });

  it("keeps other people's drafts private even through the review filter", async () => {
    const { service, prisma } = listFixture();
    await service.list(
      { ...user, roles: ["department_head"] },
      { forReview: true, status: "draft" },
    );
    expect(prisma.report.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        reviewerKind: "department_head",
        departmentId: "hr",
        NOT: [{ status: "draft", createdBy: { not: user.id } }],
      },
    });
  });

  it("limits project reports to readable projects", async () => {
    const { service, prisma } = listFixture();
    await service.list(user, { kind: "project" });
    const query = prisma.report.findMany.mock.calls[0][0] as { where: { OR: unknown[] } };
    expect(query.where.OR).toContainEqual({
      kind: "project",
      subjectId: { in: ["invited-project"] },
    });
    expect(prisma.project.findMany.mock.calls[0][0]).toMatchObject({
      where: { OR: [{ scope: "department" }, { scope: "company" }] },
    });
  });
});

function fixture(status: ReportStatus = "draft", template: ReportTemplate = "department_monthly") {
  const sections: ReportSection[] = [
    {
      id: "summary",
      type: "narrative",
      title: "My summary",
      body: "Client confirmed the shortlist",
      source: "typed",
      required: true,
    },
    { id: "highlights", type: "list", title: "What we finished", items: [] },
  ];
  const report = {
    id: "report",
    kind: template === "individual_period" ? "individual" : "department",
    template,
    status,
    reviewerKind: "ceo",
    subjectId: "hr",
    subjectUserId: null,
    createdBy: user.id,
    updatedAt: new Date("2026-10-01T09:00:00Z"),
    submissionCount: 0,
    title: "September progress",
    periodStart: new Date("2026-09-01"),
    periodEnd: new Date("2026-09-30"),
    figures: [aimsFigure("tasks_finished", "Tasks finished", 2, "count")],
    sections,
  };
  const prisma = {
    report: {
      delete: jest.fn(async (_query: unknown) => report),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async (input: { where: { id: string }; data: Record<string, unknown> }) => ({
        ...report,
        ...input.data,
      })),
    },
  };
  const access = {
    loadReadable: jest.fn(async () => report),
    canWrite: jest.fn(async () => true),
    isTeamReport: jest.fn(async () => false),
    projectTeamIds: jest.fn(async () => ["author", "marketing", "operations"]),
    reportTeamIds: jest.fn(async (_report: unknown) => ["author", "marketing", "operations"]),
    isReviewer: jest.fn(async () => true),
  };
  const content = {
    build: jest.fn<(...args: unknown[]) => Promise<ReportContent>>().mockResolvedValue({
      figures: [aimsFigure("tasks_finished", "Tasks finished", 3, "count")],
      lists: { updates: [update] },
    }),
  };
  const notifier = {
    notify: jest.fn(async (_ids: unknown, _event: unknown) => undefined),
    toCeo: jest.fn(async () => undefined),
  };
  Object.assign(prisma, { reportMessage: { create: jest.fn(async () => ({})) } });
  const documents = {
    deleteAllForResource: jest.fn(async (_type: unknown, _id: unknown) => undefined),
  };
  const service = new ReportsService(
    prisma as unknown as PrismaService,
    documents as unknown as DocumentsService,
    notifier as unknown as ReportNotifierService,
    access as unknown as ReportAccessService,
    content as unknown as ReportContentService,
  );
  return { service, prisma, access, content, report, notifier, documents };
}

describe("refreshing report drafts from work", () => {
  it.each<ReportTemplate>(["department_monthly", "individual_period"])(
    "adds work updates to an older %s draft while preserving its writing and order",
    async (template) => {
      const { service, report } = fixture("draft", template);
      const result = await service.refreshFigures("report", user);
      const sections = readSections(result.sections, report.template);
      expect(sections.map((section) => section.id)).toEqual(["summary", "highlights", "updates"]);
      expect(sections[0]).toEqual(readSections([report.sections[0]], report.template)[0]);
      expect(sections[2]).toMatchObject({
        id: "updates",
        type: "list",
        items: [update],
        required: false,
      });
    },
  );

  it("refreshes an existing work section once and keeps manual entries", async () => {
    const { service, report } = fixture();
    const manual = { text: "Client agreed the next interview date", source: "typed" as const };
    report.sections.push({
      id: "updates",
      type: "list",
      title: "Our client work",
      items: [{ text: "Previous system entry", source: "aims" }, manual],
    });
    const sections = readSections(
      (await service.refreshFigures("report", user)).sections,
      report.template,
    );
    expect(sections.filter((section) => section.id === "updates")).toHaveLength(1);
    expect(sections.find((section) => section.id === "updates")).toMatchObject({
      title: "Our client work",
      items: [update, manual],
    });
  });

  it("removes stale system entries when the refreshed period has none, preserving manual entries", async () => {
    const { service, report, content } = fixture();
    const manual = { text: "Client agreed the next interview date", source: "typed" as const };
    report.sections.push({
      id: "updates",
      type: "list",
      title: "Work handled",
      items: [{ text: "Work no longer in this period", source: "aims" }, manual],
    });
    content.build.mockResolvedValue({ figures: [], lists: { updates: [] } });
    const sections = readSections(
      (await service.refreshFigures("report", user)).sections,
      report.template,
    );
    expect(sections.find((section) => section.id === "updates")?.items).toEqual([manual]);
  });

  it("keeps edited figures while updating their system values", async () => {
    const { service, report } = fixture();
    report.figures[0] = {
      ...report.figures[0],
      value: 7,
      source: "typed",
      note: "Includes confirmed client work",
    };
    const result = await service.refreshFigures("report", user);
    expect(result.figures).toEqual([
      expect.objectContaining({
        value: 7,
        systemValue: 3,
        source: "typed",
        note: "Includes confirmed client work",
      }),
    ]);
  });

  it("preserves custom sections for which AIMS supplies no replacement list", async () => {
    const { service, report } = fixture();
    const custom = {
      id: "client-notes",
      type: "list" as const,
      title: "Client notes",
      items: [{ text: "Earlier client agreement", source: "aims" as const }],
    };
    report.sections.push(custom);
    const sections = readSections(
      (await service.refreshFigures("report", user)).sections,
      report.template,
    );
    expect(sections.find((section) => section.id === custom.id)).toEqual(
      readSections([custom], report.template)[0],
    );
  });

  it("does not add an empty work section to an older draft", async () => {
    const { service, content, report } = fixture();
    content.build.mockResolvedValue({ figures: [], lists: { updates: [] } });
    const sections = readSections(
      (await service.refreshFigures("report", user)).sections,
      report.template,
    );
    expect(sections.map((section) => section.id)).toEqual(["summary", "highlights"]);
  });

  it("allows a returned report to be refreshed before it is resent", async () => {
    const { service, prisma } = fixture("changes_requested");
    await service.refreshFigures("report", user);
    expect(prisma.report.update).toHaveBeenCalledTimes(1);
  });

  it("allows the author to keep a shared project report current", async () => {
    const { service, prisma, report } = fixture("shared", "project_progress");
    report.kind = "project";
    report.reviewerKind = "none";
    await service.refreshFigures("report", user);
    expect(prisma.report.update).toHaveBeenCalledTimes(1);
  });

  it.each<ReportStatus>(["submitted", "approved"])(
    "prevents %s reports from changing through refresh",
    async (status) => {
      const { service, prisma, content } = fixture(status);
      await expect(service.refreshFigures("report", user)).rejects.toThrow("This report is locked");
      expect(content.build).not.toHaveBeenCalled();
      expect(prisma.report.update).not.toHaveBeenCalled();
    },
  );

  it("keeps refresh restricted to the person writing the report", async () => {
    const { service, report, content, prisma } = fixture();
    report.createdBy = "someone-else";
    await expect(service.refreshFigures("report", user)).rejects.toThrow(
      "Someone else is writing this report",
    );
    expect(content.build).not.toHaveBeenCalled();
    expect(prisma.report.update).not.toHaveBeenCalled();
  });

  it("checks writing access before refreshing", async () => {
    const { service, access, content, prisma } = fixture();
    access.canWrite.mockResolvedValue(false);
    await expect(service.refreshFigures("report", user)).rejects.toThrow(
      "Only people in this department",
    );
    expect(content.build).not.toHaveBeenCalled();
    expect(prisma.report.update).not.toHaveBeenCalled();
  });
});

describe("shared company reports", () => {
  function teamFixture(status: ReportStatus = "draft") {
    const result = fixture(status, "project_progress");
    result.report.kind = "project";
    result.report.createdBy = "a-teammate";
    result.access.isTeamReport.mockResolvedValue(true);
    return result;
  }

  it("lets any member edit another member's shared draft", async () => {
    const { service, report, prisma } = teamFixture();
    await service.update(
      report.id,
      { expectedUpdatedAt: report.updatedAt.toISOString(), summary: "Team progress" },
      user,
    );
    expect(prisma.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: report.id, updatedAt: report.updatedAt },
        data: expect.objectContaining({ summary: "Team progress" }),
      }),
    );
  });

  it("requires the version of a team report before saving", async () => {
    const { service, report, prisma } = teamFixture();
    await expect(service.update(report.id, { summary: "Team progress" }, user)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.report.update).not.toHaveBeenCalled();
  });

  it("rejects stale edits without writing or sending a second notification", async () => {
    const { service, report, prisma, notifier } = teamFixture();
    await expect(
      service.update(report.id, { expectedUpdatedAt: "2026-10-01T08:00:00Z", submit: true }, user),
    ).rejects.toThrow(ConflictException);
    expect(prisma.report.update).not.toHaveBeenCalled();
    expect(notifier.toCeo).not.toHaveBeenCalled();
  });

  it("handles a competing update after the report has been loaded", async () => {
    const { service, report, prisma } = teamFixture();
    prisma.report.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Changed", { code: "P2025", clientVersion: "test" }),
    );
    await expect(
      service.update(report.id, { expectedUpdatedAt: report.updatedAt.toISOString() }, user),
    ).rejects.toThrow(ConflictException);
  });

  it("keeps files when a teammate submits a draft during deletion", async () => {
    const { service, report, prisma, documents } = teamFixture();
    prisma.report.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Changed", { code: "P2025", clientVersion: "test" }),
    );
    await expect(service.remove(report.id, user)).rejects.toThrow(ConflictException);
    expect(documents.deleteAllForResource).not.toHaveBeenCalled();
  });

  it("lets a teammate delete a shared draft and removes its attachments", async () => {
    const { service, report, prisma, documents } = teamFixture();
    await expect(service.remove(report.id, user)).resolves.toEqual({ id: report.id });
    expect(prisma.report.delete).toHaveBeenCalledWith({
      where: { id: report.id, updatedAt: report.updatedAt, status: "draft" },
    });
    expect(documents.deleteAllForResource).toHaveBeenCalledWith("department_report", report.id);
  });

  it("rejects a competing CEO decision without notifying the team again", async () => {
    const { service, report, prisma, notifier } = teamFixture("submitted");
    prisma.report.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Changed", { code: "P2025", clientVersion: "test" }),
    );
    await expect(
      service.review(report.id, { decision: "approve" }, { ...user, roles: ["ceo"] }),
    ).rejects.toThrow(ConflictException);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it("sends legacy shared company reports to the CEO when a team member submits them", async () => {
    const { service, report, notifier } = teamFixture("shared");
    report.reviewerKind = "none";
    const saved = await service.update(
      report.id,
      { expectedUpdatedAt: report.updatedAt.toISOString(), submit: true },
      user,
    );
    expect(saved).toMatchObject({ status: "submitted", reviewerKind: "ceo", submittedBy: user.id });
    expect(notifier.toCeo).toHaveBeenCalledTimes(1);
  });

  it("notifies the whole team about CEO feedback", async () => {
    const { service, report, notifier } = teamFixture("submitted");
    await service.review(
      report.id,
      { decision: "request_changes", note: "Add the rollout date" },
      { ...user, roles: ["ceo"] },
    );
    expect(notifier.notify).toHaveBeenCalledWith(
      ["author", "marketing", "operations"],
      expect.objectContaining({ type: "report_reviewed" }),
    );
  });

  it.each<ReportStatus>(["submitted", "approved"])(
    "keeps %s team reports locked",
    async (status) => {
      const { service, report, prisma } = teamFixture(status);
      await expect(
        service.update(report.id, { expectedUpdatedAt: report.updatedAt.toISOString() }, user),
      ).rejects.toThrow("with its reviewer");
      expect(prisma.report.update).not.toHaveBeenCalled();
    },
  );

  it("reuses one report when two teammates start the same period concurrently", async () => {
    let stored: {
      id: string;
      kind: string;
      subjectId: string;
      creator: { fullName: string; email: string; roles: { role: string }[] };
    } | null = null;
    const prisma = {
      report: {
        findFirst: jest.fn(async () => stored),
        create: jest.fn(async () => {
          if (stored)
            throw new Prisma.PrismaClientKnownRequestError("Duplicate", {
              code: "P2002",
              clientVersion: "test",
            });
          stored = {
            id: "shared",
            kind: "project",
            subjectId: "project",
            creator: { fullName: "A teammate", email: "staff@example.test", roles: [] },
          };
          return stored;
        }),
      },
    };
    const access = {
      canWrite: jest.fn(async () => true),
      isTeamReport: jest.fn(async () => true),
      resolveSubject: jest.fn(async () => ({
        kind: "project",
        subjectId: "project",
        name: "Expansion",
        departmentId: null,
        subjectUserId: null,
        reviewerKind: "ceo",
      })),
    };
    const content = { build: jest.fn(async () => ({ figures: [], lists: {} })) };
    const service = new ReportsService(
      prisma as unknown as PrismaService,
      {} as DocumentsService,
      {} as ReportNotifierService,
      access as unknown as ReportAccessService,
      content as unknown as ReportContentService,
    );
    const dto = {
      kind: "project" as const,
      subjectId: "project",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    };
    const reports = await Promise.all([
      service.start(dto, user),
      service.start(dto, { ...user, id: "marketing" }),
    ]);
    expect(reports.map((report) => report.id)).toEqual(["shared", "shared"]);
    const again = await service.start(dto, { ...user, id: "operations" });
    expect(again.id).toBe("shared");
    expect(prisma.report.create).toHaveBeenCalledTimes(2);
  });
});

describe("shared department report editing", () => {
  function departmentFixture(status: ReportStatus = "draft") {
    const result = fixture(status);
    result.report.createdBy = "a-colleague";
    result.access.isTeamReport.mockResolvedValue(true);
    return result;
  }

  it("lets a teammate save another author's department draft with its version", async () => {
    const { service, report } = departmentFixture();
    await expect(
      service.update(
        report.id,
        { expectedUpdatedAt: report.updatedAt.toISOString(), summary: "Department progress" },
        user,
      ),
    ).resolves.toMatchObject({ summary: "Department progress" });
  });

  it("prevents read-only colleagues from editing a shared department draft", async () => {
    const { service, access, report, prisma } = departmentFixture();
    access.canWrite.mockResolvedValue(false);
    await expect(
      service.update(report.id, { expectedUpdatedAt: report.updatedAt.toISOString() }, user),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.report.update).not.toHaveBeenCalled();
  });

  it("requires a version before saving a department draft", async () => {
    const { service, report, prisma } = departmentFixture();
    await expect(
      service.update(report.id, { summary: "An unversioned edit" }, user),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.report.update).not.toHaveBeenCalled();
  });

  it("sends department feedback to the authorised team", async () => {
    const { service, report, notifier, access } = departmentFixture("submitted");
    await service.review(
      report.id,
      { decision: "request_changes", note: "Add the client outcomes" },
      { ...user, roles: ["ceo"] },
    );
    expect(access.reportTeamIds).toHaveBeenCalledWith(report);
    expect(notifier.notify).toHaveBeenCalledWith(
      ["author", "marketing", "operations"],
      expect.objectContaining({ type: "report_reviewed" }),
    );
  });
});

describe("opening a department report already started by a teammate", () => {
  it("opens the same period without creating another report", async () => {
    const existing = {
      id: "department-draft",
      createdBy: "colleague",
      creator: { fullName: "Colleague", email: "colleague@example.test", roles: [] },
    };
    const prisma = {
      report: { findFirst: jest.fn(async () => existing), create: jest.fn(async () => ({})) },
    };
    const access = {
      resolveSubject: jest.fn(async () => ({
        name: "HR",
        departmentId: "hr",
        subjectUserId: null,
        reviewerKind: "ceo",
      })),
      canWrite: jest.fn(async () => true),
      isTeamReport: jest.fn(async () => true),
    };
    const content = { build: jest.fn(async () => ({ figures: [], lists: {} })) };
    const service = new ReportsService(
      prisma as unknown as PrismaService,
      {} as DocumentsService,
      {} as ReportNotifierService,
      access as unknown as ReportAccessService,
      content as unknown as ReportContentService,
    );
    expect(
      await service.start(
        { kind: "department", subjectId: "hr", periodStart: "2026-09-01", periodEnd: "2026-09-30" },
        user,
      ),
    ).toMatchObject({ id: "department-draft" });
    expect(prisma.report.create).not.toHaveBeenCalled();
    expect(content.build).not.toHaveBeenCalled();
  });
});
