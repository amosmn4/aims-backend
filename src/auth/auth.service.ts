import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "./types/authenticated-user";

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async validateCredentials(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { roles: true, department: true, office: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        "Your account setup isn't complete — check your email for a setup link",
      );
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid email or password");
    }

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
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: setupToken.userId }, data: { passwordHash } }),
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

  issueTokens(user: AuthenticatedUser) {
    const payload = { sub: user.id };
    const accessToken = this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
      expiresIn: this.config.get<string>("JWT_ACCESS_TTL", "15m") as `${number}m`,
    });
    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
      expiresIn: this.config.get<string>("JWT_REFRESH_TTL", "7d") as `${number}d`,
    });
    return { accessToken, refreshToken };
  }

  async refreshAccessToken(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { roles: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    return this.issueTokens({
      id: user.id,
      email: user.email,
      roles: user.roles.map((r) => r.role),
      departmentId: user.departmentId,
    });
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true, department: true, office: true },
    });
    if (!user) throw new UnauthorizedException();

    const { passwordHash: _passwordHash, roles, ...rest } = user;
    return { ...rest, roles: roles.map((r) => r.role) };
  }
}
