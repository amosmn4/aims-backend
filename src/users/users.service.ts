import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import type { AppRole, User } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { isSystemAdmin } from "../common/is-system-admin";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { CreateUserDto } from "./dto/create-user.dto";
import type { UpdateUserDto } from "./dto/update-user.dto";
import { EmailService } from "../notifications/email/email.service";
import { renderInviteEmail } from "./user-invite-email.util";

const SALT_ROUNDS = 10;
const SETUP_TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  // System admins are invisible to everyone except another system admin — including the CEO
  // — everywhere in the app. This is the one place that rule is enforced for the full listing;
  // findAllLite() below enforces the same rule for the lightweight picker endpoint.
  async findAll(viewer: AuthenticatedUser) {
    const users = await this.prisma.user.findMany({
      where: isSystemAdmin(viewer) ? undefined : { roles: { none: { role: "system_admin" } } },
      include: { roles: true, department: true, office: true },
      orderBy: { createdAt: "desc" },
    });
    return users.map(({ passwordHash, ...user }) => ({ ...user, hasPassword: passwordHash !== null }));
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

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash: null,
        fullName: dto.fullName,
        departmentId: dto.departmentId,
        officeId: dto.officeId,
        roles: { create: dto.roles.map((role) => ({ role })) },
      },
      include: { roles: true, department: true, office: true },
    });
    const inviteSent = await this.issueSetupTokenAndEmail(user);
    const { passwordHash: _passwordHash, ...rest } = user;
    return { ...rest, inviteSent };
  }

  async resendInvite(id: string, viewer: AuthenticatedUser) {
    await this.assertTargetVisible(id, viewer);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");
    if (user.passwordHash !== null) {
      throw new BadRequestException("User has already set a password");
    }
    const inviteSent = await this.issueSetupTokenAndEmail(user);
    return { inviteSent };
  }

  // Issues a fresh single-use setup token and emails the "set your password" link. Used both
  // by create() (initial invite) and resendInvite() (admin-triggered resend) — the two flows
  // differ only in when they're called, not in what they do once a user needs a fresh token.
  private async issueSetupTokenAndEmail(user: User): Promise<boolean> {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await this.prisma.passwordSetupToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + SETUP_TOKEN_TTL_MS),
      },
    });

    const frontendUrl = this.config.get<string>("CORS_ORIGIN") ?? "http://localhost:3000";
    const link = `${frontendUrl}/set-password?token=${rawToken}`;
    return this.email.send(
      user.email,
      "You've been added to AIMS — set your password",
      renderInviteEmail(user.fullName ?? user.email, link),
    );
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
