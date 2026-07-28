import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { CookieOptions, Request, Response } from "express";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { DemoLoginDto } from "./dto/demo-login.dto";
import { SetPasswordDto } from "./dto/set-password.dto";
import { Public } from "./decorators/public.decorator";
import { CurrentUser } from "./decorators/current-user.decorator";
import type { AuthenticatedUser } from "./types/authenticated-user";
import { UsersService } from "../users/users.service";
import { DEMO_USERS } from "./demo-users.const";

const REFRESH_COOKIE = "aims_refresh_token";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  private refreshCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.get("NODE_ENV") === "production",
      path: "/api/v1/auth",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.authService.validateCredentials(dto.email, dto.password);
    const authUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      roles: user.roles.map((r) => r.role),
      departmentId: user.departmentId,
    };
    const { accessToken, refreshToken } = this.authService.issueTokens(authUser);

    res.cookie(REFRESH_COOKIE, refreshToken, this.refreshCookieOptions());
    return { accessToken, user: authUser };
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) throw new UnauthorizedException("No refresh token provided");

    const { accessToken, refreshToken: newRefreshToken } =
      await this.authService.refreshAccessToken(refreshToken);
    res.cookie(REFRESH_COOKIE, newRefreshToken, this.refreshCookieOptions());
    return { accessToken };
  }

  @Post("logout")
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    return { success: true };
  }

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("set-password")
  @HttpCode(200)
  async setPassword(@Body() dto: SetPasswordDto, @Res({ passthrough: true }) res: Response) {
    const { authUser, accessToken, refreshToken } = await this.authService.setPassword(
      dto.token,
      dto.password,
    );
    res.cookie(REFRESH_COOKIE, refreshToken, this.refreshCookieOptions());
    return { accessToken, user: authUser };
  }

  @Public()
  @Get("demo-credentials")
  demoCredentials() {
    return Object.entries(DEMO_USERS).map(([role, u]) => ({ role, ...u }));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("demo-login")
  @HttpCode(200)
  async demoLogin(@Body() dto: DemoLoginDto, @Res({ passthrough: true }) res: Response) {
    const cfg = DEMO_USERS[dto.role];
    const user = await this.usersService.ensureDemoUser(
      dto.role,
      cfg.email,
      cfg.password,
      cfg.fullName,
    );
    const authUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      roles: user.roles.map((r) => r.role),
      departmentId: user.departmentId,
    };
    const { accessToken, refreshToken } = this.authService.issueTokens(authUser);

    res.cookie(REFRESH_COOKIE, refreshToken, this.refreshCookieOptions());
    return { accessToken, user: authUser };
  }
}
