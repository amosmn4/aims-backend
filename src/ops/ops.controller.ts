import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
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
import { OpsService } from "./ops.service";
import { parse, revisionSchema, schemas, type Collection, type Viewer } from "./ops.schemas";

const revision = (req: Request) => parse(revisionSchema, Number(req.headers["if-match"] ?? NaN));
function collection(value: string): Collection {
  if (!Object.prototype.hasOwnProperty.call(schemas, value))
    throw new BadRequestException("Unknown Ops collection.");
  return value as Collection;
}

@Public()
@UseGuards(OpsAuthGuard)
@Controller("ops")
export class OpsController {
  constructor(
    private readonly ops: OpsService,
    private readonly storage: StorageService,
  ) {}

  @Put("accounts/:id/modules")
  setModuleAccess(
    @OpsViewer() viewer: Viewer,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.ops.setModuleAccess(viewer, id, body, revision(req));
  }

  @Get("workspace")
  @Header("Cache-Control", "no-store")
  workspace(@OpsViewer() viewer: Viewer) {
    return this.ops.workspace(viewer);
  }

  @Get("records/:collection")
  @Header("Cache-Control", "no-store")
  async list(
    @OpsViewer() viewer: Viewer,
    @Param("collection") name: string,
    @Query() query: Record<string, string>,
  ) {
    const page = parse(z.coerce.number().int().min(1).max(100000).default(1), query.page);
    const limit = parse(z.coerce.number().int().min(1).max(200).default(50), query.limit);
    const search = parse(z.string().max(200).default(""), query.search).toLowerCase();
    const { workspace, revision: currentRevision } = await this.ops.workspace(viewer);
    const rows = workspace[collection(name)].filter(
      (row) => !search || JSON.stringify(row).toLowerCase().includes(search),
    );
    return {
      items: rows.slice((page - 1) * limit, page * limit),
      page,
      limit,
      total: rows.length,
      revision: currentRevision,
    };
  }

  @Put("records/:collection/:id")
  save(
    @OpsViewer() viewer: Viewer,
    @Param("collection") name: string,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    if (!body || typeof body !== "object" || !("id" in body) || body.id !== id)
      throw new BadRequestException("Record ID does not match the URL.");
    return this.ops.save(viewer, collection(name), body, revision(req));
  }

  @Delete("records/:collection/:id")
  remove(
    @OpsViewer() viewer: Viewer,
    @Param("collection") name: string,
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    return this.ops.remove(viewer, collection(name), id, revision(req));
  }

  @Post("reports/:id/review")
  @HttpCode(200)
  review(
    @OpsViewer() viewer: Viewer,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const dto = parse(z.object({ comment: z.string().max(10000).optional() }).strict(), body);
    return this.ops.review(viewer, id, dto.comment, revision(req));
  }

  @Post("tasks/:id/comment")
  @HttpCode(200)
  commentTask(
    @OpsViewer() viewer: Viewer,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const dto = parse(z.object({ comment: z.string().max(10000) }).strict(), body);
    return this.ops.commentTask(viewer, id, dto.comment, revision(req));
  }

  @Get("reports/:id/reviews")
  history(@OpsViewer() viewer: Viewer, @Param("id") id: string) {
    return this.ops.reviewHistory(viewer, id);
  }

  @Put("settings")
  settings(@OpsViewer() viewer: Viewer, @Body() body: unknown, @Req() req: Request) {
    return this.ops.settings(viewer, body, revision(req));
  }

  @Patch("accounts/:id")
  account(
    @OpsViewer() viewer: Viewer,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const dto = parse(
      z.object({ role: z.enum(["ceo", "staff"]), active: z.boolean() }).strict(),
      body,
    );
    return this.ops.account(viewer, id, dto.role, dto.active, revision(req));
  }

  @Put("business-permissions/:person")
  permissions(
    @OpsViewer() viewer: Viewer,
    @Param("person") person: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const dto = parse(
      z
        .object({
          home: z.string().max(36).nullable(),
          grants: z
            .array(z.string().max(36))
            .max(500)
            .refine((values) => new Set(values).size === values.length),
        })
        .strict(),
      body,
    );
    return this.ops.businessPermissions(viewer, person, dto.home, dto.grants, revision(req));
  }

  @Post("invitations")
  invite(@OpsViewer() viewer: Viewer, @Body() body: unknown, @Req() req: Request) {
    return this.ops.invite(viewer, body, revision(req));
  }

  @Post("accounts/:id/invitation")
  renew(@OpsViewer() viewer: Viewer, @Param("id") id: string, @Req() req: Request) {
    return this.ops.renewInvitation(viewer, id, revision(req));
  }

  @Post("documents")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 1, fieldSize: 100000 },
    }),
  )
  upload(
    @OpsViewer() viewer: Viewer,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    const dto = parse(z.object({ metadata: z.string().max(100000) }).strict(), body);
    let metadata: unknown;
    try {
      metadata = JSON.parse(dto.metadata);
    } catch {
      throw new BadRequestException("Invalid document metadata.");
    }
    return this.ops.upload(viewer, metadata, file, revision(req));
  }

  @Get("documents/:id/content")
  async content(@OpsViewer() viewer: Viewer, @Param("id") id: string, @Res() res: Response) {
    const doc = await this.ops.document(viewer, id);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    return this.storage.streamToResponse(doc.storageKey, res, {
      disposition: "attachment",
      fileName: doc.name,
      contentType: "application/octet-stream",
    });
  }
}
