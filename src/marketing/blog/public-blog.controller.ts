import { Body, Controller, Get, Param, Post, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { BlogService } from "./blog.service";
import { RecordEngagementDto } from "./dto/record-engagement.dto";
import { Public } from "../../auth/decorators/public.decorator";
import { PublicBlogApiKeyGuard } from "./public-blog-api-key.guard";
import { StorageService } from "../../storage/storage.service";

const ENGAGEMENT_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

// The whole public surface amsol.africa (or any other consumer) needs: one authenticated call to
// read everything, one authenticated call to report engagement, and two unauthenticated media
// streams (an <img>/<video> tag can't send an Authorization header, so those two stay open —
// see PublicBlogApiKeyGuard's own comment). See /blogAPI.md for the integration guide.
@Controller("public/blog")
export class PublicBlogController {
  constructor(
    private readonly blogService: BlogService,
    private readonly storage: StorageService,
  ) {}

  @Get("feed")
  @Public()
  @UseGuards(PublicBlogApiKeyGuard)
  feed() {
    return this.blogService.findPublishedFeed();
  }

  @Post("engagement")
  @Public()
  @UseGuards(PublicBlogApiKeyGuard)
  @Throttle(ENGAGEMENT_THROTTLE)
  engagement(@Body() dto: RecordEngagementDto) {
    return this.blogService.recordEngagement(dto.slug, dto.type, dto.seconds);
  }

  @Get("images/:postId")
  @Public()
  async image(@Param("postId") postId: string, @Res() res: Response) {
    const { key, mimeType } = await this.blogService.getImageForPublic(postId);
    await this.storage.streamToResponse(key, res, { disposition: "inline", contentType: mimeType });
  }

  @Get("videos/:postId")
  @Public()
  async video(@Param("postId") postId: string, @Res() res: Response) {
    const { key, mimeType } = await this.blogService.getVideoForPublic(postId);
    await this.storage.streamToResponse(key, res, { disposition: "inline", contentType: mimeType });
  }
}
