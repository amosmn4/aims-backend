import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { BlogService } from "./blog.service";
import { StorageService } from "../../storage/storage.service";
import { CreateBlogPostDto } from "./dto/create-blog-post.dto";
import { UpdateBlogPostDto } from "./dto/update-blog-post.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

// CMS surface — authenticated. See public-blog.controller.ts for the unauthenticated read +
// engagement-tracking API that the site rendering these posts would actually call.
@Controller("blog-posts")
export class BlogController {
  constructor(
    private readonly blogService: BlogService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @Roles()
  findAll() {
    return this.blogService.findAll();
  }

  @Get(":id")
  @Roles()
  findOne(@Param("id") id: string) {
    return this.blogService.findOne(id);
  }

  @Post()
  @Roles("marketing")
  create(@Body() dto: CreateBlogPostDto, @CurrentUser() user: AuthenticatedUser) {
    return this.blogService.create(dto, user);
  }

  @Patch(":id")
  @Roles("marketing")
  update(@Param("id") id: string, @Body() dto: UpdateBlogPostDto) {
    return this.blogService.update(id, dto);
  }

  @Delete(":id")
  @Roles("marketing")
  remove(@Param("id") id: string) {
    return this.blogService.remove(id);
  }

  @Post(":id/image")
  @Roles("marketing")
  @UseInterceptors(FileInterceptor("file"))
  uploadImage(@Param("id") id: string, @UploadedFile() file: Express.Multer.File) {
    return this.blogService.uploadImage(id, file);
  }

  // Admin preview — streams the image regardless of publish status, unlike the public route.
  @Get(":id/image")
  @Roles()
  async image(@Param("id") id: string, @Res() res: Response) {
    const { key, mimeType } = await this.blogService.getImageForAdmin(id);
    await this.storage.streamToResponse(key, res, { disposition: "inline", contentType: mimeType });
  }

  @Post(":id/video")
  @Roles("marketing")
  @UseInterceptors(FileInterceptor("file"))
  uploadVideo(@Param("id") id: string, @UploadedFile() file: Express.Multer.File) {
    return this.blogService.uploadVideo(id, file);
  }

  // Admin preview — streams the video regardless of publish status, unlike the public route.
  @Get(":id/video")
  @Roles()
  async video(@Param("id") id: string, @Res() res: Response) {
    const { key, mimeType } = await this.blogService.getVideoForAdmin(id);
    await this.storage.streamToResponse(key, res, { disposition: "inline", contentType: mimeType });
  }

  @Post(":id/publish")
  @Roles("marketing")
  publish(@Param("id") id: string) {
    return this.blogService.publish(id);
  }

  @Post(":id/unpublish")
  @Roles("marketing")
  unpublish(@Param("id") id: string) {
    return this.blogService.unpublish(id);
  }
}
