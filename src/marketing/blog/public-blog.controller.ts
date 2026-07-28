import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { BlogService } from "./blog.service";
import { RecordTimeSpentDto } from "./dto/record-time-spent.dto";
import { Public } from "../../auth/decorators/public.decorator";
import { StorageService } from "../../storage/storage.service";

const ENGAGEMENT_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
const DEFAULT_LIMIT = 20;

// Unauthenticated surface — this is what the site actually rendering these blog posts calls.
// No @Roles() here: @Public() skips the JwtAuthGuard entirely, so there's no authenticated
// user context on these requests.
@Controller("public/blog")
export class PublicBlogController {
  constructor(
    private readonly blogService: BlogService,
    private readonly storage: StorageService,
  ) {}

  @Get("posts")
  @Public()
  list(@Query("limit") limit?: string, @Query("offset") offset?: string) {
    const take = Math.min(Number(limit) || DEFAULT_LIMIT, 100);
    const skip = Number(offset) || 0;
    return this.blogService.findPublished(take, skip);
  }

  @Get("posts/:slug")
  @Public()
  detail(@Param("slug") slug: string) {
    return this.blogService.findPublishedBySlug(slug);
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

  @Post("posts/:slug/view")
  @Public()
  @Throttle(ENGAGEMENT_THROTTLE)
  view(@Param("slug") slug: string) {
    return this.blogService.recordView(slug);
  }

  @Post("posts/:slug/like")
  @Public()
  @Throttle(ENGAGEMENT_THROTTLE)
  like(@Param("slug") slug: string) {
    return this.blogService.recordLike(slug);
  }

  @Post("posts/:slug/share")
  @Public()
  @Throttle(ENGAGEMENT_THROTTLE)
  share(@Param("slug") slug: string) {
    return this.blogService.recordShare(slug);
  }

  @Post("posts/:slug/time-spent")
  @Public()
  @Throttle(ENGAGEMENT_THROTTLE)
  timeSpent(@Param("slug") slug: string, @Body() dto: RecordTimeSpentDto) {
    return this.blogService.recordTimeSpent(slug, dto.seconds);
  }
}
