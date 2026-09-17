import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ConfigService } from "@nestjs/config";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthenticatedUser } from "../types/authenticated-user";

type AccessTokenPayload = { sub: string; act?: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("JWT_ACCESS_SECRET"),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { roles: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid or expired session");
    }
    if (payload.act) {
      const actor = await this.prisma.user.findUnique({
        where: { id: payload.act },
        include: { roles: true },
      });
      if (!actor?.isActive || !actor.roles.some((r) => r.role === "system_admin")) {
        throw new UnauthorizedException("Invalid or expired session");
      }
    }

    return {
      id: user.id,
      email: user.email,
      roles: user.roles.map((r) => r.role),
      departmentId: user.departmentId,
      ...(payload.act && { actorId: payload.act }),
    };
  }
}
