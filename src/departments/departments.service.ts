import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateDepartmentDto } from "./dto/create-department.dto";
import type { UpdateDepartmentDto } from "./dto/update-department.dto";

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.department.findMany({ orderBy: { sortOrder: "asc" } });
  }

  create(dto: CreateDepartmentDto) {
    return this.prisma.department.create({ data: dto });
  }

  update(id: string, dto: UpdateDepartmentDto) {
    return this.prisma.department.update({ where: { id }, data: dto });
  }

  // Project/Tender/ServiceLine all use onDelete: Restrict against Department — pre-check and
  // name the blockers instead of letting Prisma throw a raw FK error.
  async remove(id: string) {
    const [projectCount, tenderCount, serviceLineCount] = await Promise.all([
      this.prisma.project.count({ where: { departmentId: id } }),
      this.prisma.tender.count({ where: { departmentId: id } }),
      this.prisma.serviceLine.count({ where: { departmentId: id } }),
    ]);
    if (projectCount > 0 || tenderCount > 0 || serviceLineCount > 0) {
      const parts: string[] = [];
      if (projectCount > 0) parts.push(`${projectCount} project${projectCount === 1 ? "" : "s"}`);
      if (tenderCount > 0) parts.push(`${tenderCount} tender${tenderCount === 1 ? "" : "s"}`);
      if (serviceLineCount > 0)
        parts.push(`${serviceLineCount} service line${serviceLineCount === 1 ? "" : "s"}`);
      throw new BadRequestException(
        `Can't delete this department — it still has ${parts.join(" and ")}.`,
      );
    }
    return this.prisma.department.delete({ where: { id } });
  }
}
