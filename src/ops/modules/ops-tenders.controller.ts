import { Body, Controller, Get, Header, Param, Patch, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { StorageService } from "../../storage/storage.service";
import { z } from "zod";
import { Public } from "../../auth/decorators/public.decorator";
import { OpsAuthGuard, OpsViewer } from "../ops-auth.guard";
import { parse, type Viewer } from "../ops.schemas";
import { OpsTendersService } from "./ops-tenders.service";
import { UpdateTenderDto } from "../../crm/tenders/dto/update-tender.dto";
import { UpdateTenderStageDto } from "../../crm/tenders/dto/update-tender-stage.dto";
import { CreateTenderDto } from "../../crm/tenders/dto/create-tender.dto";

@Public()
@UseGuards(OpsAuthGuard)
@Controller("ops/tenders")
export class OpsTendersController {
  constructor(
    private readonly tenders: OpsTendersService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@OpsViewer() viewer: Viewer) {
    return this.tenders.list(viewer);
  }

  @Get("assignees")
  @Header("Cache-Control", "private, no-store")
  assignees(@OpsViewer() viewer: Viewer) {
    return this.tenders.assignees(viewer);
  }

  @Get("options")
  options(@OpsViewer() viewer: Viewer) {
    return this.tenders.options(viewer);
  }

  @Post()
  create(@OpsViewer() viewer: Viewer, @Body() body: CreateTenderDto) {
    return this.tenders.create(viewer, body);
  }

  @Patch(":id/assignment")
  assign(@OpsViewer() viewer: Viewer, @Param("id") id: string, @Body() body: unknown) {
    const dto = parse(z.object({ accountManagerId: z.string().uuid() }).strict(), body);
    return this.tenders.assign(viewer, id, dto.accountManagerId);
  }

  @Get(":id")
  @Header("Cache-Control", "private, no-store")
  detail(@OpsViewer() viewer: Viewer, @Param("id") id: string) {
    return this.tenders.detail(viewer, parse(z.string().uuid(), id));
  }

  @Patch(":id")
  update(@OpsViewer() viewer: Viewer, @Param("id") id: string, @Body() dto: UpdateTenderDto) {
    return this.tenders.update(viewer, parse(z.string().uuid(), id), dto);
  }

  @Patch(":id/stage")
  stage(@OpsViewer() viewer: Viewer, @Param("id") id: string, @Body() dto: UpdateTenderStageDto) {
    return this.tenders.stage(viewer, parse(z.string().uuid(), id), dto);
  }

  @Get(":id/documents/:documentId/content")
  async document(
    @OpsViewer() viewer: Viewer,
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Res() res: Response,
  ) {
    const row = await this.tenders.document(
      viewer,
      parse(z.string().uuid(), id),
      parse(z.string().uuid(), documentId),
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    return this.storage.streamToResponse(row.storagePath, res, {
      disposition: "attachment",
      fileName: row.fileName,
      contentType: "application/octet-stream",
    });
  }
}
