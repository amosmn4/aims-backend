import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

// Guards the two "business" public-blog endpoints (feed + engagement) with a single shared
// secret — the website authenticates once with this key instead of AIMS's normal user JWT
// (there's no logged-in AIMS user on the other end). Deliberately NOT applied to the image/video
// streaming routes: a plain <img src>/<video src> tag can't attach a custom header, so those stay
// open (same as before) — they're only ever published-post media anyway, no different from a
// public CDN asset.
@Injectable()
export class PublicBlogApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>("PUBLIC_BLOG_API_KEY");
    if (!expected) {
      throw new UnauthorizedException(
        "The public blog API is not configured — PUBLIC_BLOG_API_KEY is unset.",
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const provided = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

    if (!provided || provided !== expected) {
      throw new UnauthorizedException("Invalid or missing API key");
    }
    return true;
  }
}
