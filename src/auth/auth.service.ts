import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "./types/authenticated-user";
import { parseTtlToMs, type TtlString } from "./ttl.util";
import { viewerDepartmentCodes } from "../common/department-scope";
import { can } from "../common/permission-resolution";
import { isSystemAdmin } from "../common/is-system-admin";
import { effectiveCapabilities } from "../common/capabilities";

type RefreshPayload = { sub: string; sessionStart: number; act?: string };

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // Distinct messages per failure (not a blanket "invalid email or password") — this is an
  // invite-only internal system with no public signup, so telling someone their work email
  // isn't registered doesn't expose anything a stranger could act on the way it would on a
  // public consumer app; the usability win for staff who mistype their email or forget which
  // address they were invited on is worth more here than the marginal enumeration risk.
  async validateCredentials(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { roles: true, department: true, office: true },
    });

    if (!user) {
      throw new UnauthorizedException(
        "This email isn't registered. Check the address, or ask for an invite.",
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException("This account has been deactivated.");
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        "Your account setup isn't complete — check your email for a setup link",
      );
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException("That password is incorrect. Please try again.");
    }

    const now = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now, lastActiveAt: now },
    });
    return user;
  }

  // Verifies a PasswordSetupToken (invite or resend-invite), sets the user's password, burns
  // the token (and any other unused tokens for that user, to avoid stale-link races), and signs
  // the user straight in — mirrors login()'s token issuance so the frontend can redirect
  // directly into the app after setup completes.
  async setPassword(token: string, password: string) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const setupToken = await this.prisma.passwordSetupToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { roles: true } } },
    });

    if (!setupToken || setupToken.usedAt || setupToken.expiresAt < new Date()) {
      throw new UnauthorizedException("This link is invalid or has expired");
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: setupToken.userId },
        data: { passwordHash, lastLoginAt: now, lastActiveAt: now },
      }),
      this.prisma.passwordSetupToken.updateMany({
        where: { userId: setupToken.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    const authUser: AuthenticatedUser = {
      id: setupToken.user.id,
      email: setupToken.user.email,
      roles: setupToken.user.roles.map((r) => r.role),
      departmentId: setupToken.user.departmentId,
    };
    return { authUser, ...this.issueTokens(authUser) };
  }

  // `sessionStart` is carried unchanged through every sliding renewal (see refreshAccessToken)
  // so the absolute JWT_REFRESH_TTL ceiling can still be enforced no matter how many times the
  // idle window below has been rolled forward. Defaults to "now" — i.e. a fresh login.
  issueTokens(user: AuthenticatedUser, sessionStart: number = Date.now(), actorId?: string) {
    const act = actorId ? { act: actorId } : {};
    const accessToken = this.jwt.sign(
      { sub: user.id, ...act },
      {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        expiresIn: this.config.get<string>("JWT_ACCESS_TTL", "15m") as TtlString,
      },
    );
    // The refresh JWT's own expiry is the sliding idle window, not the absolute ceiling — a
    // stolen/replayed refresh token this old is worthless even before the cookie is checked.
    const refreshToken = this.jwt.sign(
      { sub: user.id, sessionStart, ...act },
      {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
        expiresIn: this.config.get<string>("JWT_IDLE_TTL", "2h") as TtlString,
      },
    );
    return { accessToken, refreshToken };
  }

  // Sliding inactivity timeout + absolute ceiling. Every successful call here means the session
  // was actually used (the frontend only calls /auth/refresh on page load and when an access
  // token has expired mid-use), so it's a real activity signal: a new refresh token is issued
  // with the idle window (JWT_IDLE_TTL) rolled fully forward again, and the controller re-sets
  // the cookie to match. Go quiet for longer than JWT_IDLE_TTL — tab closed, laptop asleep, no
  // API calls — and the refresh JWT itself has already expired by the time anything asks for a
  // new one. `sessionStart` is never touched by the rolling renewal, so JWT_REFRESH_TTL still
  // forces a real login after that long even if the session never once sat idle.
  async refreshAccessToken(refreshToken: string) {
    const payload = this.verifyRefresh(refreshToken);

    const absoluteTtlMs = parseTtlToMs(this.config.get<string>("JWT_REFRESH_TTL", "7d"));
    if (Date.now() - payload.sessionStart > absoluteTtlMs) {
      throw new UnauthorizedException("Your session has expired — please log in again");
    }

    if (payload.act) {
      const actor = await this.loadAuthUser(payload.act);
      if (!actor || !isSystemAdmin(actor)) {
        throw new UnauthorizedException("Invalid or expired refresh token");
      }
      const target = await this.loadAuthUser(payload.sub);
      return target && this.isViewAsTarget(target)
        ? this.issueTokens(target, payload.sessionStart, actor.id)
        : this.issueTokens(actor, payload.sessionStart);
    }

    const authUser = await this.loadAuthUser(payload.sub);
    if (!authUser) throw new UnauthorizedException("Invalid or expired refresh token");
    await this.touchActivity(authUser.id);
    return this.issueTokens(authUser, payload.sessionStart);
  }

  private verifyRefresh(refreshToken: string): RefreshPayload {
    try {
      return this.jwt.verify(refreshToken, {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
  }

  // Refreshes happen every few minutes of use; keep writes to at most one per 5 minutes.
  private async touchActivity(userId: string) {
    const cutoff = new Date(Date.now() - 5 * 60_000);
    await this.prisma.user.updateMany({
      where: { id: userId, OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: cutoff } }] },
      data: { lastActiveAt: new Date() },
    });
  }

  private async loadAuthUser(id: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { roles: true } });
    if (!user?.isActive) return null;
    return {
      id: user.id,
      email: user.email,
      roles: user.roles.map((r) => r.role),
      departmentId: user.departmentId,
    };
  }

  private isViewAsTarget(user: AuthenticatedUser) {
    return user.roles.includes("ceo") && !isSystemAdmin(user);
  }

  private assertCanViewAs(user: AuthenticatedUser) {
    if (!isSystemAdmin(user) || user.actorId) throw new NotFoundException();
  }

  async viewAsTargets(user: AuthenticatedUser) {
    this.assertCanViewAs(user);
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        AND: [{ roles: { some: { role: "ceo" } } }, { roles: { none: { role: "system_admin" } } }],
      },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: "asc" },
    });
  }

  async startViewAs(user: AuthenticatedUser, targetId: string, currentRefresh?: string) {
    this.assertCanViewAs(user);
    const target = await this.loadAuthUser(targetId);
    if (!target || !this.isViewAsTarget(target))
      throw new NotFoundException("CEO account not found");
    const sessionStart = currentRefresh
      ? this.verifyRefresh(currentRefresh).sessionStart
      : Date.now();
    await this.recordViewAs(user.id, "view_as.start", target.id);
    return this.issueTokens(target, sessionStart, user.id);
  }

  async exitViewAs(user: AuthenticatedUser, currentRefresh?: string) {
    if (!user.actorId) throw new NotFoundException();
    const actor = await this.loadAuthUser(user.actorId);
    if (!actor) throw new UnauthorizedException("Invalid or expired session");
    const sessionStart = currentRefresh
      ? this.verifyRefresh(currentRefresh).sessionStart
      : Date.now();
    await this.recordViewAs(actor.id, "view_as.end", user.id);
    return this.issueTokens(actor, sessionStart);
  }

  private recordViewAs(actorId: string, action: string, targetId: string) {
    return this.prisma.auditLog.create({
      data: { userId: actorId, action, entityType: "users", entityId: targetId },
    });
  }

  async updateProfile(
    viewer: AuthenticatedUser,
    dto: { fullName?: string; phone?: string | null; jobTitle?: string | null },
  ) {
    await this.prisma.user.update({
      where: { id: viewer.id },
      data: {
        fullName: dto.fullName?.trim(),
        phone: dto.phone === undefined ? undefined : dto.phone?.trim() || null,
        jobTitle: dto.jobTitle === undefined ? undefined : dto.jobTitle?.trim() || null,
      },
    });
    return this.getProfile(viewer);
  }

  async changePassword(
    viewer: AuthenticatedUser,
    dto: { currentPassword: string; newPassword: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: viewer.id },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException("Your current password isn't right");
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException("Choose a new password that's different from the current one");
    }
    await this.prisma.user.update({
      where: { id: viewer.id },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, SALT_ROUNDS) },
    });
    return { success: true };
  }

  async getProfile(viewer: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: viewer.id },
      include: { roles: true, department: true, office: true },
    });
    if (!user) throw new UnauthorizedException();

    const { passwordHash: _passwordHash, roles, ...rest } = user;
    const roleList = roles.map((r) => r.role);
    return {
      ...rest,
      roles: roleList,
      departmentAccess: await this.departmentAccess({
        id: user.id,
        email: user.email,
        roles: roleList,
        departmentId: user.departmentId,
      }),
      capabilities: effectiveCapabilities({
        id: user.id,
        email: user.email,
        roles: roleList,
        departmentId: user.departmentId,
      }),
      ...(viewer.actorId && { viewAs: true }),
    };
  }

  // Department codes this user can read/write (roles + overrides); null means every department.
  private async departmentAccess(user: AuthenticatedUser) {
    const read = await viewerDepartmentCodes(user, this.prisma);
    if (read === null) return { read: null, write: null };
    const departments = await this.prisma.department.findMany({ select: { id: true, code: true } });
    const write: string[] = [];
    for (const d of departments) if (await can(user, d, "write", this.prisma)) write.push(d.code);
    return { read, write };
  }
}
