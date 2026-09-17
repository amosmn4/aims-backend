import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { BlogPost } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { StorageService } from "../../storage/storage.service";
import { sanitizeRichText } from "../../common/sanitize";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateBlogPostDto } from "./dto/create-blog-post.dto";
import type { UpdateBlogPostDto } from "./dto/update-blog-post.dto";
import type { EngagementType } from "./dto/record-engagement.dto";

const KEY_PREFIX = "blog";

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm"]);
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;

function sanitizeContent(content: string | undefined): string | undefined {
  return content === undefined ? undefined : sanitizeRichText(content);
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "post"
  );
}

function avgTimeSpent(
  post: Pick<BlogPost, "totalTimeSpentSeconds" | "timeSpentSamples">,
): number | null {
  return post.timeSpentSamples > 0
    ? Math.round(post.totalTimeSpentSeconds / post.timeSpentSamples)
    : null;
}

// Field names here deliberately mirror the amsol.africa site's MDX frontmatter shape
// (date/cover, not publishedAt/imageUrl) — see /blogAPI.md for the full integration guide.
// The CMS-facing endpoints (blog.controller.ts) keep the DB's own naming; only this public
// payload is shaped for an external consumer.
function mapPublicSummary(post: BlogPost) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    tags: post.tags,
    authorName: post.authorName,
    date: post.publishedAt,
    cover: post.imagePath ? `/public/blog/images/${post.id}` : null,
    video: post.videoPath ? `/public/blog/videos/${post.id}` : null,
    views: post.views,
    likes: post.likes,
    shares: post.shares,
    avgTimeSpentSeconds: avgTimeSpent(post),
  };
}

function mapPublicDetail(post: BlogPost) {
  return { ...mapPublicSummary(post), content: sanitizeRichText(post.content) };
}

@Injectable()
export class BlogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /* ---------- CMS (authenticated) ---------- */

  findAll() {
    return this.prisma.blogPost.findMany({ orderBy: { createdAt: "desc" } });
  }

  findOne(id: string) {
    return this.prisma.blogPost.findUniqueOrThrow({ where: { id } });
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = slugify(base);
    let suffix = 1;
    while (await this.prisma.blogPost.findUnique({ where: { slug } })) {
      suffix += 1;
      slug = `${slugify(base)}-${suffix}`;
    }
    return slug;
  }

  async create(dto: CreateBlogPostDto, user: AuthenticatedUser) {
    const slug = await this.uniqueSlug(dto.title);
    return this.prisma.blogPost.create({
      data: {
        slug,
        title: dto.title,
        excerpt: dto.excerpt,
        content: sanitizeContent(dto.content),
        tags: dto.tags,
        authorName: dto.authorName,
        createdBy: user.id,
      },
    });
  }

  update(id: string, dto: UpdateBlogPostDto) {
    return this.prisma.blogPost.update({
      where: { id },
      data: {
        title: dto.title,
        excerpt: dto.excerpt,
        content: sanitizeContent(dto.content),
        tags: dto.tags,
        authorName: dto.authorName,
      },
    });
  }

  async remove(id: string) {
    const post = await this.prisma.blogPost.findUniqueOrThrow({ where: { id } });
    if (post.imagePath) {
      await this.storage.delete(`${KEY_PREFIX}/${post.imagePath}`);
    }
    if (post.videoPath) {
      await this.storage.delete(`${KEY_PREFIX}/${post.videoPath}`);
    }
    return this.prisma.blogPost.delete({ where: { id } });
  }

  async publish(id: string) {
    const post = await this.prisma.blogPost.findUniqueOrThrow({ where: { id } });
    if (!post.excerpt?.trim() || !post.content?.trim()) {
      throw new BadRequestException("Add an excerpt and content before publishing");
    }
    return this.prisma.blogPost.update({
      where: { id },
      data: { status: "published", publishedAt: post.publishedAt ?? new Date() },
    });
  }

  unpublish(id: string) {
    return this.prisma.blogPost.update({ where: { id }, data: { status: "draft" } });
  }

  private validateImage(file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No image was uploaded");
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new BadRequestException("Image exceeds the 5MB upload limit");
    }
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`Image type "${file.mimetype}" is not allowed`);
    }
  }

  async uploadImage(id: string, file: Express.Multer.File) {
    this.validateImage(file);
    const post = await this.prisma.blogPost.findUniqueOrThrow({ where: { id } });

    if (post.imagePath) {
      await this.storage.delete(`${KEY_PREFIX}/${post.imagePath}`);
    }

    const safeName = file.originalname.replace(/[^a-z0-9.\-_]+/gi, "_");
    const storedName = `${Date.now()}-${safeName}`;
    const imagePath = `${id}/${storedName}`;
    await this.storage.write(`${KEY_PREFIX}/${imagePath}`, file.buffer);

    return this.prisma.blogPost.update({
      where: { id },
      data: { imagePath, imageMimeType: file.mimetype },
    });
  }

  async getImageForAdmin(id: string) {
    const post = await this.prisma.blogPost.findUniqueOrThrow({ where: { id } });
    return this.resolveImageFile(post);
  }

  private resolveImageFile(post: BlogPost) {
    if (!post.imagePath || !post.imageMimeType) {
      throw new NotFoundException("This post has no image");
    }
    return { key: `${KEY_PREFIX}/${post.imagePath}`, mimeType: post.imageMimeType };
  }

  private validateVideo(file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No video was uploaded");
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      throw new BadRequestException("Video exceeds the 50MB upload limit");
    }
    if (!ALLOWED_VIDEO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`Video type "${file.mimetype}" is not allowed`);
    }
  }

  async uploadVideo(id: string, file: Express.Multer.File) {
    this.validateVideo(file);
    const post = await this.prisma.blogPost.findUniqueOrThrow({ where: { id } });

    if (post.videoPath) {
      await this.storage.delete(`${KEY_PREFIX}/${post.videoPath}`);
    }

    const safeName = file.originalname.replace(/[^a-z0-9.\-_]+/gi, "_");
    const storedName = `${Date.now()}-${safeName}`;
    const videoPath = `${id}/${storedName}`;
    await this.storage.write(`${KEY_PREFIX}/${videoPath}`, file.buffer);

    return this.prisma.blogPost.update({
      where: { id },
      data: { videoPath, videoMimeType: file.mimetype },
    });
  }

  async getVideoForAdmin(id: string) {
    const post = await this.prisma.blogPost.findUniqueOrThrow({ where: { id } });
    return this.resolveVideoFile(post);
  }

  private resolveVideoFile(post: BlogPost) {
    if (!post.videoPath || !post.videoMimeType) {
      throw new NotFoundException("This post has no video");
    }
    return { key: `${KEY_PREFIX}/${post.videoPath}`, mimeType: post.videoMimeType };
  }

  /* ---------- Public (API-key authenticated — see PublicBlogApiKeyGuard) ---------- */

  // The one read call the website makes: every published post, full content included, on every
  // item — not just a summary list — so the site never needs a second "get one post" round trip.
  // Cheap enough to send whole: blog volume is posts-per-week, not rows-at-scale, and the site is
  // expected to poll this every 30-60s (or on page load), not hold a connection open.
  async findPublishedFeed() {
    const posts = await this.prisma.blogPost.findMany({
      where: { status: "published" },
      orderBy: { publishedAt: "desc" },
    });
    return posts.map(mapPublicDetail);
  }

  // Media stays unauthenticated (see the guard's own comment) — the published-status check here
  // is the only gate: draft images/videos are never reachable by id-guessing.
  async getImageForPublic(postId: string) {
    const post = await this.prisma.blogPost.findUniqueOrThrow({ where: { id: postId } });
    if (post.status !== "published") {
      throw new ForbiddenException("This post is not published");
    }
    return this.resolveImageFile(post);
  }

  async getVideoForPublic(postId: string) {
    const post = await this.prisma.blogPost.findUniqueOrThrow({ where: { id: postId } });
    if (post.status !== "published") {
      throw new ForbiddenException("This post is not published");
    }
    return this.resolveVideoFile(post);
  }

  // One write call replacing the old four (view/like/share/time-spent) — `type` picks the
  // counter. Returns the updated post so the site can optimistically refresh the number it just
  // incremented without waiting for the next feed poll.
  async recordEngagement(slug: string, type: EngagementType, seconds?: number) {
    const post = await this.prisma.blogPost.findUnique({ where: { slug } });
    if (!post || post.status !== "published") {
      throw new NotFoundException("Post not found");
    }

    const data =
      type === "view"
        ? { views: { increment: 1 } }
        : type === "like"
          ? { likes: { increment: 1 } }
          : type === "share"
            ? { shares: { increment: 1 } }
            : {
                totalTimeSpentSeconds: { increment: seconds ?? 0 },
                timeSpentSamples: { increment: 1 },
              };

    const updated = await this.prisma.blogPost.update({ where: { id: post.id }, data });
    return mapPublicDetail(updated);
  }
}
