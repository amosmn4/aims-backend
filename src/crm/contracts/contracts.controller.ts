import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ContractsService } from "./contracts.service";
import { StorageService } from "../../storage/storage.service";
import { CreateContractDto } from "./dto/create-contract.dto";
import { UpdateContractDto } from "./dto/update-contract.dto";
import { UploadDocumentDto } from "./dto/upload-document.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { PaginationQueryDto } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";

@Controller("contracts")
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @Roles()
  findAll(
    @Query("departmentId") departmentId?: string,
    @Query("clientId") clientId?: string,
    @Query() pagination?: PaginationQueryDto,
  ) {
    return this.contractsService.findAll({ departmentId, clientId }, pagination);
  }

  @Get(":id")
  @Roles()
  findOne(@Param("id") id: string) {
    return this.contractsService.findOne(id);
  }

  @Post()
  @Roles("finance", "hr", "it", "marketing", "tender")
  create(@Body() dto: CreateContractDto, @CurrentUser() user: AuthenticatedUser) {
    return this.contractsService.create(dto, user);
  }

  @Patch(":id")
  @Roles("finance", "hr", "it", "marketing", "tender")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateContractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contractsService.update(id, dto, user);
  }

  @Delete(":id")
  @Roles("finance", "hr", "it", "marketing", "tender")
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.contractsService.remove(id, user);
  }

  @Get(":id/documents")
  @Roles()
  listDocuments(@Param("id") id: string) {
    return this.contractsService.listDocuments(id);
  }

  @Post(":id/documents")
  @Roles()
  @UseInterceptors(FileInterceptor("file"))
  uploadDocument(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contractsService.uploadDocument(id, file, dto, user.id);
  }

  @Get("documents/:documentId/download")
  @Roles()
  async downloadDocument(@Param("documentId") documentId: string, @Res() res: Response) {
    const { doc, key } = await this.contractsService.getDocumentFile(documentId);
    await this.storage.streamToResponse(key, res, { disposition: "attachment", fileName: doc.fileName });
  }

  @Delete("documents/:documentId")
  @Roles()
  removeDocument(@Param("documentId") documentId: string) {
    return this.contractsService.deleteDocument(documentId);
  }
}
