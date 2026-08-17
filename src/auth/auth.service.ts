import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedUser } from "./types/authenticated-user";
import { parseTtlToMs, type TtlString } from "./ttl.util";

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
        "This email isn't registered. Check the address, or ask your administrator for an invite.",
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        "This account has been deactivated. Contact your administrator.",
      );
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

  // `sessionStart` is carried unchanged through every sliding renewal (see refreshAccessToken)
  // so the absolute JWT_REFRESH_TTL ceiling can still be enforced no matter how many times the
  // idle window below has been rolled forward. Defaults to "now" — i.e. a fresh login.
  issueTokens(user: AuthenticatedUser, sessionStart: number = Date.now()) {
    const accessToken = this.jwt.sign(
      { sub: user.id },
      {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        expiresIn: this.config.get<string>("JWT_ACCESS_TTL", "15m") as TtlString,
      },
    );
    // The refresh JWT's own expiry is the sliding idle window, not the absolute ceiling — a
    // stolen/replayed refresh token this old is worthless even before the cookie is checked.
    const refreshToken = this.jwt.sign(
      { sub: user.id, sessionStart },
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
    let payload: { sub: string; sessionStart: number };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const absoluteTtlMs = parseTtlToMs(this.config.get<string>("JWT_REFRESH_TTL", "7d"));
    if (Date.now() - payload.sessionStart > absoluteTtlMs) {
      throw new UnauthorizedException("Your session has expired — please log in again");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { roles: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const authUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      roles: user.roles.map((r) => r.role),
      departmentId: user.departmentId,
    };
    return this.issueTokens(authUser, payload.sessionStart);
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
