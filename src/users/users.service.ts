import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import type { AppRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { isSystemAdmin } from "../common/is-system-admin";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { CreateUserDto } from "./dto/create-user.dto";
import type { UpdateUserDto } from "./dto/update-user.dto";

const SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // System admins are invisible to everyone except another system admin — including the CEO
  // — everywhere in the app. This is the one place that rule is enforced for the full listing;
  // findAllLite() below enforces the same rule for the lightweight picker endpoint.
  async findAll(viewer: AuthenticatedUser) {
    const users = await this.prisma.user.findMany({
      where: isSystemAdmin(viewer) ? undefined : { roles: { none: { role: "system_admin" } } },
      include: { roles: true, department: true, office: true },
      orderBy: { createdAt: "desc" },
    });
    return users.map(({ passwordHash: _passwordHash, ...user }) => user);
  }

  findAllLite(viewer: AuthenticatedUser) {
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        ...(isSystemAdmin(viewer) ? {} : { roles: { none: { role: "system_admin" } } }),
      },
      select: { id: true, email: true, fullName: true },
      orderBy: { fullName: "asc" },
    });
  }

  async create(dto: CreateUserDto, viewer: AuthenticatedUser) {
    if (dto.roles.includes("system_admin") && !isSystemAdmin(viewer)) {
      throw new ForbiddenException("Only a system administrator can grant the system_admin role");
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        fullName: dto.fullName,
        departmentId: dto.departmentId,
        officeId: dto.officeId,
        roles: { create: dto.roles.map((role) => ({ role })) },
      },
      include: { roles: true, department: true, office: true },
    });
    const { passwordHash: _passwordHash, ...rest } = user;
    return rest;
  }

  async update(id: string, dto: UpdateUserDto, viewer: AuthenticatedUser) {
    await this.assertTargetVisible(id, viewer);
    if (dto.roles?.includes("system_admin") && !isSystemAdmin(viewer)) {
      throw new ForbiddenException("Only a system administrator can grant the system_admin role");
    }

    const { roles, ...profile } = dto;

    if (roles) {
      await this.prisma.userRole.deleteMany({ where: { userId: id } });
      await this.prisma.userRole.createMany({ data: roles.map((role) => ({ userId: id, role })) });
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: profile,
      include: { roles: true, department: true, office: true },
    });
    const { passwordHash: _passwordHash, ...rest } = user;
    return rest;
  }

  // A 404 (not 403) here — a system admin's record must appear not to exist at all to a
  // non-admin caller, matching "never exposed" rather than merely "access denied".
  private async assertTargetVisible(id: string, viewer: AuthenticatedUser) {
    if (isSystemAdmin(viewer)) return;
    const target = await this.prisma.user.findUnique({ where: { id }, include: { roles: true } });
    if (target && target.roles.some((r) => r.role === "system_admin")) {
      throw new NotFoundException("User not found");
    }
  }

  /**
   * Finds-or-creates a demo account for the given role, resetting its password to a
   * known demo value — mirrors the previous Supabase `ensureDemoUser` server function
   * so the demo-login flow keeps working during the Supabase -> backend migration.
   */
  async ensureDemoUser(role: AppRole, email: string, password: string, fullName: string) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await this.prisma.user.upsert({
      where: { email },
      create: { email, passwordHash, fullName, roles: { create: [{ role }] } },
      update: { passwordHash },
      include: { roles: true },
    });

    if (!user.roles.some((r) => r.role === role)) {
      await this.prisma.userRole.create({ data: { userId: user.id, role } });
    }

    return user;
  }
}
