import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { DocumentsService } from "./documents.service";
import { UploadDocumentDto } from "./dto/upload-document.dto";
import { UpdateDocumentDto } from "./dto/update-document.dto";
import { SetAccessGrantsDto } from "./dto/set-access-grants.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

// One resource-agnostic endpoint surface, reused by both the central library page and the
// per-resource AttachmentsPanel (different query params against the same table) rather than
// Contracts-style nested routes — see DocumentsService for why that keeps them automatically
// in sync.
@Controller("documents")
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @Roles()
  findAll(
    @Query("resourceType") resourceType: string | undefined,
    @Query("resourceId") resourceId: string | undefined,
    @Query("departmentId") departmentId: string | undefined,
    @Query("tag") tag: string | undefined,
    @Query("q") q: string | undefined,
    @Query("mine") mine: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.findAll(
      { resourceType, resourceId, departmentId, tag, q, mine: mine === "true" },
      user,
    );
  }

  @Get(":id")
  @Roles()
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.findOne(id, user);
  }

  @Post()
  @Roles()
  @UseInterceptors(FileInterceptor("file"))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.upload(file, dto, user);
  }

  @Get(":id/download")
  @Roles()
  async download(
    @Param("id") id: string,
    @Query("versionId") versionId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { fileName, fullPath } = await this.documentsService.getFileForDownload(id, versionId, user);
    res.download(fullPath, fileName);
  }

  @Get(":id/versions")
  @Roles()
  listVersions(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.listVersions(id, user);
  }

  @Post(":id/versions")
  @Roles()
  @UseInterceptors(FileInterceptor("file"))
  addVersion(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.addVersion(id, file, user);
  }

  @Patch(":id")
  @Roles()
  update(
    @Param("id") id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.update(id, dto, user);
  }

  @Delete(":id")
  @Roles()
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.remove(id, user);
  }

  @Get(":id/access")
  @Roles()
  getAccess(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.getAccess(id, user);
  }

  @Put(":id/access")
  @Roles()
  setAccess(
    @Param("id") id: string,
    @Body() dto: SetAccessGrantsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.setAccess(id, dto, user);
  }
}
