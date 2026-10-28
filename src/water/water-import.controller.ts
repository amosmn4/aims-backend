import {
  BadRequestException,
  Body,
  Controller,
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
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { StorageService } from "../storage/storage.service";
import { WaterImportService } from "./water-import.service";
import { MAX_IMPORT_BYTES } from "./water-file-extraction.service";
import {
  ConfirmWaterImportDto,
  ConfirmReadyWaterImportDto,
  UpdateWaterImportRowDto,
} from "./dto/water-import.dto";

@Controller("water/imports")
@Roles("water")
export class WaterImportController {
  constructor(
    private readonly imports: WaterImportService,
    private readonly storage: StorageService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.imports.upload(file, user);
  }

  @Get()
  list() {
    return this.imports.list();
  }

  @Get(":id/source")
  async source(@Param("id") id: string, @Res() response: Response) {
    const batch = await this.imports.source(id);
    return this.storage.streamToResponse(batch.storageKey, response, {
      disposition: "attachment",
      contentType: batch.mimeType,
      fileName: batch.fileName,
    });
  }

  @Get(":id")
  get(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page = "1",
    @Query("status") status?: string,
  ) {
    const number = Number(page);
    if (!Number.isSafeInteger(number) || number < 1 || number > 1000)
      throw new BadRequestException("Choose a valid import page.");
    if (status && !["pending", "imported", "duplicate", "ignored"].includes(status))
      throw new BadRequestException("Unknown row status.");
    return this.imports.get(id, user, number, status);
  }

  @Patch(":id/rows/:rowId")
  updateRow(
    @Param("id") id: string,
    @Param("rowId") rowId: string,
    @Body() dto: UpdateWaterImportRowDto,
  ) {
    return this.imports.updateRow(id, rowId, dto.data);
  }

  @Post(":id/confirm")
  confirm(
    @Param("id") id: string,
    @Body() dto: ConfirmWaterImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.imports.confirm(id, dto, user);
  }

  @Post(":id/retry")
  retry(@Param("id") id: string) {
    return this.imports.retry(id);
  }

  @Post(":id/confirm-ready")
  confirmReady(
    @Param("id") id: string,
    @Body() _dto: ConfirmReadyWaterImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.imports.beginRecording(id, user);
  }
}
