import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import * as crypto from "crypto";
import type { User } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { isSystemAdmin } from "../common/is-system-admin";
import { maybePaginate, type PaginationQueryDto } from "../common/pagination";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { CreateUserDto } from "./dto/create-user.dto";
import type { UpdateUserDto } from "./dto/update-user.dto";
import { EmailService } from "../notifications/email/email.service";
import { renderInviteEmail, renderResetPasswordEmail } from "./user-invite-email.util";

const SETUP_TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  // System admin accounts are invisible in the Users & Roles admin UI, full stop — never shown
  // in the list, never offered as a "grant role" option, not even to another system admin. The
  // role is seeded/self-managed outside this screen; keeping it off the list entirely (rather
  // than just hidden from non-admins) keeps the day-to-day admin UI free of the one account with
  // unrestricted access. findAllLite() below enforces the same rule for the lightweight picker
  // endpoint.
  async findAll(viewer: AuthenticatedUser, pagination: PaginationQueryDto = {}) {
    const result = await maybePaginate(
      this.prisma.user,
      {
        where: { roles: { none: { role: "system_admin" } } },
        include: { roles: true, department: true, office: true },
        orderBy: { createdAt: "desc" },
      },
      pagination,
    );
    const strip = (u: { passwordHash: string | null }) => {
      const { passwordHash, ...rest } = u;
      return { ...rest, hasPassword: passwordHash !== null };
    };
    return Array.isArray(result) ? result.map(strip) : { ...result, data: result.data.map(strip) };
  }

  findAllLite(_viewer: AuthenticatedUser) {
    return this.prisma.user.findMany({
      where: { isActive: true, roles: { none: { role: "system_admin" } } },
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
    const { inviteSent, setupLink } = await this.issueSetupTokenAndEmail(user, "invite");
    const { passwordHash: _passwordHash, ...rest } = user;
    return { ...rest, inviteSent, setupLink };
  }

  async resendInvite(id: string, viewer: AuthenticatedUser) {
    await this.assertTargetVisible(id, viewer);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");
    if (user.passwordHash !== null) {
      throw new BadRequestException("User has already set a password");
    }
    return this.issueSetupTokenAndEmail(user, "invite");
  }

  // Admin-triggered reset for a user who already has a password (resendInvite above refuses
  // that case on purpose, since it's meant only for users who never finished onboarding) —
  // same single-use token mechanism, just reachable regardless of current password state and
  // sent with "reset" rather than "welcome" copy.
  async resetPassword(id: string, viewer: AuthenticatedUser) {
    await this.assertTargetVisible(id, viewer);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");
    return this.issueSetupTokenAndEmail(user, "reset");
  }

  async remove(id: string, viewer: AuthenticatedUser) {
    await this.assertTargetVisible(id, viewer);
    if (id === viewer.id) {
      throw new BadRequestException("You can't delete your own account");
    }
    const target = await this.prisma.user.findUnique({ where: { id }, include: { roles: true } });
    if (!target) throw new NotFoundException("User not found");
    if (target.roles.some((r) => r.role === "system_admin")) {
      const otherAdmins = await this.prisma.userRole.count({
        where: { role: "system_admin", userId: { not: id } },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException("Can't delete the last System Administrator account");
      }
    }
    await this.prisma.user.delete({ where: { id } });
    return { id };
  }

  // Issues a fresh single-use setup token and emails a "set your password" link — used by
  // create() (initial invite), resendInvite() (admin-triggered resend for a not-yet-onboarded
  // user), and resetPassword() (admin-triggered reset for an active user); they differ only in
  // when they're called and which email copy goes out. Always returns the raw link too (not
  // just whether the email sent) so the admin UI can offer "copy invite link" as a fallback —
  // the raw token only ever exists here in memory; the DB stores just its hash.
  private async issueSetupTokenAndEmail(
    user: User,
    kind: "invite" | "reset",
  ): Promise<{ inviteSent: boolean; setupLink: string }> {
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
    const setupLink = `${frontendUrl}/set-password?token=${rawToken}`;
    const inviteSent = await this.email.send(
      user.email,
      kind === "invite"
        ? "You've been added to AIMS — set your password"
        : "Reset your AIMS password",
      kind === "invite"
        ? renderInviteEmail(user.fullName ?? user.email, setupLink)
        : renderResetPasswordEmail(user.fullName ?? user.email, setupLink),
    );
    return { inviteSent, setupLink };
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
}
