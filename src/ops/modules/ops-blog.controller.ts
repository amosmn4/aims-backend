import { UseGuards } from "@nestjs/common";
import { Public } from "../../auth/decorators/public.decorator";
import { OpsAuthGuard } from "../ops-auth.guard";
import { OpsFeature, OpsModuleGuard } from "../ops-module.guard";
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
import { BlogService } from "../../marketing/blog/blog.service";
import { StorageService } from "../../storage/storage.service";
import { CreateBlogPostDto } from "../../marketing/blog/dto/create-blog-post.dto";
import { UpdateBlogPostDto } from "../../marketing/blog/dto/update-blog-post.dto";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
@Public()
@UseGuards(OpsAuthGuard, OpsModuleGuard)
@OpsFeature("blog")
@Controller("ops/blog/posts")
export class OpsBlogController {
  constructor(
    private readonly blogService: BlogService,
    private readonly storage: StorageService,
  ) {}
  @Get()
  findAll() {
    return this.blogService.findAll();
  }
  @Get(":id")
  findOne(
    @Param("id")
    id: string,
  ) {
    return this.blogService.findOne(id);
  }
  @Post()
  create(
    @Body()
    dto: CreateBlogPostDto,
    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.blogService.create(dto, user);
  }
  @Patch(":id")
  update(
    @Param("id")
    id: string,
    @Body()
    dto: UpdateBlogPostDto,
  ) {
    return this.blogService.update(id, dto);
  }
  @Delete(":id")
  remove(
    @Param("id")
    id: string,
  ) {
    return this.blogService.remove(id);
  }
  @Post(":id/image")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  uploadImage(
    @Param("id")
    id: string,
    @UploadedFile()
    file: Express.Multer.File,
  ) {
    return this.blogService.uploadImage(id, file);
  }
  @Get(":id/image")
  async image(
    @Param("id")
    id: string,
    @Res()
    res: Response,
  ) {
    const { key, mimeType } = await this.blogService.getImageForAdmin(id);
    await this.storage.streamToResponse(key, res, { disposition: "inline", contentType: mimeType });
  }
  @Post(":id/video")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 50 * 1024 * 1024, files: 1 } }))
  uploadVideo(
    @Param("id")
    id: string,
    @UploadedFile()
    file: Express.Multer.File,
  ) {
    return this.blogService.uploadVideo(id, file);
  }
  @Get(":id/video")
  async video(
    @Param("id")
    id: string,
    @Res()
    res: Response,
  ) {
    const { key, mimeType } = await this.blogService.getVideoForAdmin(id);
    await this.storage.streamToResponse(key, res, { disposition: "inline", contentType: mimeType });
  }
  @Post(":id/publish")
  publish(
    @Param("id")
    id: string,
  ) {
    return this.blogService.publish(id);
  }
  @Post(":id/unpublish")
  unpublish(
    @Param("id")
    id: string,
  ) {
    return this.blogService.unpublish(id);
  }
}
