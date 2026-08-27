import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateHrmsLicenseDto } from "./dto/create-hrms-license.dto";
import type { UpdateHrmsLicenseDto } from "./dto/update-hrms-license.dto";

const clientSelect = { client: { select: { id: true, name: true } } };

@Injectable()
export class HrmsLicensesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.hrmsLicense.findMany({
      include: clientSelect,
      orderBy: { createdAt: "desc" },
    });
  }

  findOne(id: string) {
    return this.prisma.hrmsLicense.findUniqueOrThrow({
      where: { id },
      include: clientSelect,
    });
  }

  create(dto: CreateHrmsLicenseDto) {
    return this.prisma.hrmsLicense.create({
      data: {
        clientId: dto.clientId,
        tier: dto.tier,
        status: dto.status,
        activeUsers: dto.activeUsers,
        renewalDate: dto.renewalDate ? new Date(dto.renewalDate) : undefined,
        notes: dto.notes,
      },
      include: clientSelect,
    });
  }

  update(id: string, dto: UpdateHrmsLicenseDto) {
    return this.prisma.hrmsLicense.update({
      where: { id },
      data: {
        tier: dto.tier,
        status: dto.status,
        activeUsers: dto.activeUsers,
        renewalDate: dto.renewalDate ? new Date(dto.renewalDate) : undefined,
        notes: dto.notes,
      },
      include: clientSelect,
    });
  }

  remove(id: string) {
    return this.prisma.hrmsLicense.delete({ where: { id } });
  }
}
