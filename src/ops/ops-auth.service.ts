import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHash, createHmac, randomBytes } from "node:crypto";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { type Viewer } from "./ops.schemas";
import { EmailService } from "../notifications/email/email.service";
import { escapeHtml } from "../reports/report-email.util";

export const OPS_COOKIE = "amsol_ops_refresh";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const IDLE_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class OpsAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  private secret() {
    return createHmac("sha256", this.config.getOrThrow<string>("JWT_ACCESS_SECRET"))
      .update("amsol-ops/access/v1")
      .digest("hex");
  }

  private accessToken(staffId: string, sessionId: string) {
    return this.jwt.sign(
      { sub: staffId, sid: sessionId },
      { secret: this.secret(), expiresIn: "15m", audience: "amsol-ops", issuer: "amsol-ops-api" },
    );
  }

  async createSession(staffId: string, remember: boolean) {
    const token = randomBytes(32).toString("hex");
    const session = await this.prisma.opsSession.create({
      data: {
        staffId,
        refreshHash: hashToken(token),
        idleExpiresAt: new Date(Date.now() + IDLE_MS),
        expiresAt: new Date(Date.now() + (remember ? 7 * 24 : 12) * 60 * 60 * 1000),
      },
    });
    return { refreshToken: token, accessToken: this.accessToken(staffId, session.id) };
  }

  async login(email: string, password: string, remember: boolean) {
    const staff = await this.prisma.opsStaff.findFirst({
      where: { user: { email } },
      include: { user: true },
    });
    if (
      !staff?.active ||
      !staff.user?.isActive ||
      !staff.user.passwordHash ||
      !(await bcrypt.compare(password, staff.user.passwordHash))
    ) {
      throw new UnauthorizedException(
        "The email or password is incorrect, or Ops access has not been granted.",
      );
    }
    return this.createSession(staff.id, remember);
  }

  async viewer(sessionId: string, staffId?: string): Promise<Viewer> {
    const session = await this.prisma.opsSession.findUnique({
      where: { id: sessionId },
      include: {
        staff: {
          include: { moduleGrants: true, user: { select: { email: true, isActive: true } } },
        },
      },
    });
    const now = Date.now();
    if (
      !session ||
      session.expiresAt.getTime() <= now ||
      session.idleExpiresAt.getTime() <= now ||
      (staffId && session.staffId !== staffId)
    )
      throw new UnauthorizedException("Your session has expired. Please sign in again.");
    const staff = session.staff;
    if (!staff.active || !staff.user?.isActive)
      throw new UnauthorizedException("Your Ops account is inactive.");
    if (session.idleExpiresAt.getTime() - now < IDLE_MS - 60_000) {
      const touched = await this.prisma.opsSession.updateMany({
        where: { id: session.id, idleExpiresAt: { gt: new Date() }, expiresAt: { gt: new Date() } },
        data: { idleExpiresAt: new Date(Math.min(now + IDLE_MS, session.expiresAt.getTime())) },
      });
      if (!touched.count) throw new UnauthorizedException();
    }
    return {
      id: staff.id,
      userId: staff.userId,
      name: staff.name,
      title: staff.title,
      dept: staff.dept as Viewer["dept"],
      role: staff.role,
      active: staff.active,
      email: staff.user.email,
      sessionId: session.id,
      modules: Object.fromEntries(staff.moduleGrants.map((grant) => [grant.module, grant.access])),
    };
  }

  async authenticate(bearer: string): Promise<Viewer> {
    let payload: { sub: string; sid: string };
    try {
      payload = this.jwt.verify(bearer, {
        secret: this.secret(),
        audience: "amsol-ops",
        issuer: "amsol-ops-api",
      });
      if (typeof payload.sid !== "string" || typeof payload.sub !== "string") throw new Error();
    } catch {
      throw new UnauthorizedException("Invalid or expired session.");
    }
    return this.viewer(payload.sid, payload.sub);
  }

  async refresh(token: string) {
    const session = await this.prisma.opsSession.findUnique({
      where: { refreshHash: hashToken(token) },
    });
    if (!session) throw new UnauthorizedException("Please sign in again.");
    const viewer = await this.viewer(session.id);
    return { accessToken: this.accessToken(viewer.id, session.id) };
  }

  async logout(viewer: Viewer) {
    await this.prisma.opsSession.deleteMany({ where: { id: viewer.sessionId } });
    return { success: true };
  }

  async invitation(token: string) {
    const invitation = await this.prisma.opsInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { staff: { include: { user: { select: { email: true, isActive: true } } } } },
    });
    if (
      !invitation ||
      invitation.usedAt ||
      invitation.expiresAt.getTime() <= Date.now() ||
      !invitation.staff.active ||
      !invitation.staff.user?.isActive
    )
      throw new UnauthorizedException("This invitation is invalid or expired.");
    return invitation;
  }

  async acceptInvitation(token: string, password: string) {
    const invitation = await this.invitation(token);
    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.$transaction(async (db) => {
      await db.opsState.update({
        where: { id: "workspace" },
        data: { revision: { increment: 1 } },
      });
      const claim = await db.opsInvitation.updateMany({
        where: { id: invitation.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (!claim.count) throw new UnauthorizedException("This invitation has already been used.");
      const staff = await db.opsStaff.findUniqueOrThrow({
        where: { id: invitation.staffId },
        include: { user: true },
      });
      if (!staff.active || !staff.user?.isActive)
        throw new ForbiddenException("This account is inactive.");
      if (staff.role === "ceo") {
        const previousCeos = await db.opsStaff.findMany({
          where: { role: "ceo", id: { not: staff.id } },
          select: { id: true },
        });
        await db.opsStaff.updateMany({
          where: { role: "ceo", id: { not: staff.id } },
          data: { role: "staff" },
        });
        for (const previous of previousCeos)
          await db.auditLog.create({
            data: {
              userId: staff.userId,
              action: "ops.accounts.ceo_replaced",
              entityType: "ops_staff",
              entityId: previous.id,
              newValue: { ceoId: staff.id },
            },
          });
      }
      await db.user.update({ where: { id: staff.userId! }, data: { passwordHash } });
      await db.opsInvitation.updateMany({
        where: { staffId: staff.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await db.opsSession.deleteMany({ where: { staffId: staff.id } });
      await db.auditLog.create({
        data: {
          userId: staff.userId,
          action: "ops.invitation.accepted",
          entityType: "ops_staff",
          entityId: staff.id,
        },
      });
    });
    return this.createSession(invitation.staffId, false);
  }

  async changePassword(viewer: Viewer, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: viewer.userId! } });
    if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash)))
      throw new BadRequestException("Your current password is incorrect.");
    if (currentPassword === newPassword)
      throw new BadRequestException("Choose a different password.");
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction(async (db) => {
      await db.opsState.update({
        where: { id: "workspace" },
        data: { revision: { increment: 1 } },
      });
      const changed = await db.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash },
        data: { passwordHash },
      });
      if (!changed.count)
        throw new BadRequestException("Your password changed in another session. Sign in again.");
      await db.opsSession.deleteMany({
        where: { staffId: viewer.id, id: { not: viewer.sessionId } },
      });
      await db.opsInvitation.updateMany({
        where: { staffId: viewer.id, usedAt: null },
        data: { usedAt: new Date() },
      });
    });
    return { success: true };
  }

  async forgotPassword(email: string) {
    const staff = await this.prisma.opsStaff.findFirst({
      where: { active: true, user: { email, isActive: true } },
      include: { user: true },
    });
    if (!staff?.user) return { success: true };
    const origin = this.config.get<string>("OPS_FRONTEND_URL");
    if (!origin || !this.email.isConfigured()) return { success: true };
    const token = randomBytes(32).toString("hex");
    await this.prisma.$transaction(async (db) => {
      await db.opsPasswordReset.updateMany({
        where: { staffId: staff.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await db.opsPasswordReset.create({
        data: {
          staffId: staff.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
    });
    await this.email.send(
      staff.user.email,
      "Reset your Amsol Ops password",
      `<p>Use this link to reset your password. It expires in one hour.</p><p><a href="${escapeHtml(`${new URL(origin).origin}/login?reset=${token}`)}">Reset password</a></p>`,
    );
    return { success: true };
  }

  async resetPassword(token: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.$transaction(async (db) => {
      const reset = await db.opsPasswordReset.findUnique({
        where: { tokenHash: hashToken(token) },
      });
      if (!reset || reset.usedAt || reset.expiresAt <= new Date())
        throw new BadRequestException("This reset link is invalid or expired.");
      const staff = await db.opsStaff.findUnique({
        where: { id: reset.staffId },
        include: { user: true },
      });
      if (!staff?.active || !staff.user?.isActive)
        throw new BadRequestException("This reset link is invalid or expired.");
      const claim = await db.opsPasswordReset.updateMany({
        where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (!claim.count) throw new BadRequestException("This reset link has already been used.");
      await db.user.update({ where: { id: staff.user.id }, data: { passwordHash } });
      await db.opsPasswordReset.updateMany({
        where: { staffId: staff.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await db.opsInvitation.updateMany({
        where: { staffId: staff.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await db.passwordSetupToken.updateMany({
        where: { userId: staff.user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await db.opsSession.deleteMany({ where: { staffId: staff.id } });
      await db.opsState.update({
        where: { id: "workspace" },
        data: { revision: { increment: 1 } },
      });
      await db.auditLog.create({
        data: {
          userId: staff.user.id,
          action: "ops.password.reset",
          entityType: "ops_staff",
          entityId: staff.id,
        },
      });
    });
    return { success: true };
  }
}
