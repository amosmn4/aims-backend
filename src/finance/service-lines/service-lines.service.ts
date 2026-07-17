import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class ServiceLinesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.serviceLine.findMany({ orderBy: { sortOrder: "asc" } });
  }
}
