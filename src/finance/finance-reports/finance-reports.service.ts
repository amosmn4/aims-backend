import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { DocumentsService } from "../../documents/documents.service";
import type { CreateFinanceReportDto } from "./dto/create-finance-report.dto";
import type { UpdateReportStatusDto } from "./dto/update-report-status.dto";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
  ) {}

  findAll() {
    return this.prisma.financeReport.findMany({ orderBy: { createdAt: "desc" } });
  }

  findOne(id: string) {
    return this.prisma.financeReport.findUniqueOrThrow({ where: { id } });
  }

  create(dto: CreateFinanceReportDto, userId: string) {
    const now = new Date();
    return this.prisma.financeReport.create({
      data: {
        reportType: dto.reportType,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        title: dto.title,
        narrative: dto.narrative,
        snapshot: dto.snapshot as Prisma.InputJsonValue,
        status: dto.submit ? "submitted" : "draft",
        submittedBy: dto.submit ? userId : undefined,
        submittedAt: dto.submit ? now : undefined,
        createdBy: userId,
      },
    });
  }

  updateStatus(id: string, dto: UpdateReportStatusDto, user: AuthenticatedUser) {
    // Approval is a separation-of-duties control: the Finance team that authors and submits
    // a report cannot also be the one who approves it — only the CEO/System Administrator can.
    const isAdminOrCeo = user.roles.includes("system_admin") || user.roles.includes("ceo");
    if ((dto.status === "approved" || dto.status === "changes_requested") && !isAdminOrCeo) {
      throw new ForbiddenException("Only the CEO or System Administrator can review reports");
    }

    const now = new Date();
    const data: Prisma.FinanceReportUncheckedUpdateInput = { status: dto.status };
    if (dto.status === "submitted") {
      data.submittedBy = user.id;
      data.submittedAt = now;
    }
    if (dto.status === "approved" || dto.status === "changes_requested") {
      data.reviewedBy = user.id;
      data.reviewedAt = now;
      data.reviewNote = dto.reviewNote;
    }
    return this.prisma.financeReport.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.documentsService.deleteAllForResource("finance_report", id);
    return this.prisma.financeReport.delete({ where: { id } });
  }

  findComments(reportId: string) {
    return this.prisma.financeReportComment.findMany({
      where: { reportId },
      orderBy: { createdAt: "asc" },
    });
  }

  addComment(reportId: string, body: string, authorId: string) {
    return this.prisma.financeReportComment.create({ data: { reportId, authorId, body } });
  }
}
