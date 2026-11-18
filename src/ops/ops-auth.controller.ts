import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import type { Request, Response } from "express";
import { Public } from "../auth/decorators/public.decorator";
import { OPS_COOKIE, OpsAuthService } from "./ops-auth.service";
import { OpsAuthGuard, OpsViewer } from "./ops-auth.guard";
import { loginSchema, parse, passwordSchema, type Viewer } from "./ops.schemas";

@Public()
@Controller("ops/auth")
export class OpsAuthController {
  constructor(
    private readonly auth: OpsAuthService,
    private readonly config: ConfigService,
  ) {}

  @Get("status")
  status() {
    return { service: "Amsol Ops" };
  }

  private cookie(res: Response, token: string, remember: boolean) {
    res.cookie(OPS_COOKIE, token, {
      httpOnly: true,
      secure: this.config.get("NODE_ENV") === "production",
      sameSite: "strict",
      path: "/api/v1/ops/auth",
      ...(remember ? { maxAge: 7 * 24 * 60 * 60 * 1000 } : {}),
    });
  }

  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const dto = parse(loginSchema, body);
    const result = await this.auth.login(dto.email, dto.password, dto.remember);
    this.cookie(res, result.refreshToken, dto.remember);
    return { accessToken: result.accessToken };
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: Request) {
    const token = req.cookies?.[OPS_COOKIE];
    if (typeof token !== "string" || !token) throw new UnauthorizedException();
    return this.auth.refresh(token);
  }

  @Get("me")
  @UseGuards(OpsAuthGuard)
  me(@OpsViewer() viewer: Viewer) {
    return {
      id: viewer.id,
      personId: viewer.id,
      email: viewer.email,
      role: viewer.role,
      active: true,
      hasPassword: true,
      modules: viewer.modules ?? {},
    };
  }

  @Post("logout")
  @HttpCode(200)
  @UseGuards(OpsAuthGuard)
  async logout(@OpsViewer() viewer: Viewer, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(viewer);
    res.clearCookie(OPS_COOKIE, { path: "/api/v1/ops/auth" });
    return { success: true };
  }

  @Get("invitation")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async invitation(@Query("token") token: string) {
    parse(z.string().regex(/^[a-f0-9]{64}$/), token);
    const invitation = await this.auth.invitation(token);
    return { email: invitation.staff.user!.email };
  }

  @Post("accept-invitation")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async accept(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const dto = parse(
      z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: passwordSchema }).strict(),
      body,
    );
    const result = await this.auth.acceptInvitation(dto.token, dto.password);
    this.cookie(res, result.refreshToken, false);
    return { accessToken: result.accessToken };
  }

  @Post("change-password")
  @HttpCode(200)
  @UseGuards(OpsAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  changePassword(@OpsViewer() viewer: Viewer, @Body() body: unknown) {
    const dto = parse(
      z
        .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
        .strict(),
      body,
    );
    return this.auth.changePassword(viewer, dto.currentPassword, dto.newPassword);
  }

  @Post("forgot-password")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  forgot(@Body() body: unknown) {
    const dto = parse(
      z.object({ email: z.string().trim().toLowerCase().email().max(200) }).strict(),
      body,
    );
    return this.auth.forgotPassword(dto.email);
  }

  @Post("reset-password")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  reset(@Body() body: unknown) {
    const dto = parse(
      z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: passwordSchema }).strict(),
      body,
    );
    return this.auth.resetPassword(dto.token, dto.password);
  }
}
