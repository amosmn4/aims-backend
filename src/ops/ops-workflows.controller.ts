import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { z } from "zod";
import { Public } from "../auth/decorators/public.decorator";
import { StorageService } from "../storage/storage.service";
import { OpsAuthGuard, OpsViewer } from "./ops-auth.guard";
import { parse, revisionSchema, type Viewer } from "./ops.schemas";
import { OpsWorkflowsService } from "./ops-workflows.service";
import { PrismaService } from "../prisma/prisma.service";
import { assertCeo } from "./ops.policy";

const revision = (req: Request) => parse(revisionSchema, Number(req.headers["if-match"] ?? NaN));

@Public()
@UseGuards(OpsAuthGuard)
@Controller("ops")
export class OpsWorkflowsController {
  constructor(
    private readonly workflows: OpsWorkflowsService,
    private readonly storage: StorageService,
    private readonly db: PrismaService,
  ) {}

  @Get("leave")
  leaves(@OpsViewer() viewer: Viewer, @Query("staff") staff?: string) {
    return this.workflows.leaves(viewer, staff);
  }

  @Post("leave")
  leave(@OpsViewer() viewer: Viewer, @Body() body: unknown, @Req() req: Request) {
    return this.workflows.saveLeave(viewer, body, revision(req));
  }

  @Delete("leave/:id")
  removeLeave(@OpsViewer() viewer: Viewer, @Param("id") id: string, @Req() req: Request) {
    return this.workflows.removeLeave(viewer, id, revision(req));
  }

  @Get("submission-schedules")
  schedules(@OpsViewer() viewer: Viewer) {
    return this.workflows.schedules(viewer);
  }

  @Get("submission-reminder")
  submissionReminder(@OpsViewer() viewer: Viewer) {
    return this.workflows.submissionReminder(viewer);
  }

  @Put("submission-reminder")
  saveSubmissionReminder(@OpsViewer() viewer: Viewer, @Body() body: unknown, @Req() req: Request) {
    return this.workflows.saveSubmissionReminder(viewer, body, revision(req));
  }

  @Put("submission-schedules")
  schedule(@OpsViewer() viewer: Viewer, @Body() body: unknown, @Req() req: Request) {
    return this.workflows.schedule(viewer, body, revision(req));
  }

  @Delete("submission-schedules/:id")
  cancel(@OpsViewer() viewer: Viewer, @Param("id") id: string, @Req() req: Request) {
    return this.workflows.cancel(viewer, id, revision(req));
  }

  @Get("documents/:id/versions")
  versions(@OpsViewer() viewer: Viewer, @Param("id") id: string) {
    return this.workflows.versions(viewer, id);
  }

  @Post("documents/:id/versions")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 0 } }),
  )
  uploadVersion(
    @OpsViewer() viewer: Viewer,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this.workflows.uploadVersion(viewer, id, file, revision(req));
  }

  @Get("documents/:id/versions/:version/content")
  async versionContent(
    @OpsViewer() viewer: Viewer,
    @Param("id") id: string,
    @Param("version") raw: string,
    @Res() res: Response,
  ) {
    const row = await this.workflows.versionContent(
      viewer,
      id,
      parse(z.coerce.number().int().min(1), raw),
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    return this.storage.streamToResponse(row.storageKey, res, {
      disposition: "attachment",
      fileName: row.name,
      contentType: "application/octet-stream",
    });
  }

  @Get("dashboard/modules")
  async dashboard(@OpsViewer() viewer: Viewer) {
    assertCeo(viewer);
    const [blog, published, waterMeters, waterCustomers, tenders, inventory] = await Promise.all([
      this.db.blogPost.count(),
      this.db.blogPost.count({ where: { status: "published" } }),
      this.db.waterMeter.count(),
      this.db.waterCustomer.count(),
      this.db.tender.count(),
      this.db.inventoryItem.count(),
    ]);
    return { blog, published, waterMeters, waterCustomers, tenders, inventory };
  }
}
