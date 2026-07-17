import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateComplianceRecordDto } from "./dto/create-compliance-record.dto";

@Injectable()
export class PayrollComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const records = await this.prisma.payrollComplianceRecord.findMany({
      include: { client: true },
      orderBy: { dueDate: "asc" },
    });
    const today = new Date();
    return records.map((r) => ({
      ...r,
      // Derived, never stored: a record only becomes "overdue" by the calendar moving past
      // its due date, not by anyone flipping a flag.
      effectiveStatus: r.filedDate ? r.status : r.dueDate < today ? "overdue" : "pending",
    }));
  }

  create(dto: CreateComplianceRecordDto) {
    return this.prisma.payrollComplianceRecord.create({
      data: {
        clientId: dto.clientId,
        period: new Date(dto.period),
        filingType: dto.filingType,
        dueDate: new Date(dto.dueDate),
        notes: dto.notes,
      },
    });
  }

  async markFiled(id: string, filedDate: string) {
    const record = await this.prisma.payrollComplianceRecord.findUniqueOrThrow({ where: { id } });
    const filed = new Date(filedDate);
    const status = filed <= record.dueDate ? "filed_on_time" : "filed_late";
    return this.prisma.payrollComplianceRecord.update({
      where: { id },
      data: { filedDate: filed, status },
    });
  }
}
