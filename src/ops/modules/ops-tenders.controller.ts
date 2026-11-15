import { BadRequestException, Body, Controller, Get, Header, Param, Patch, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { Public } from "../../auth/decorators/public.decorator";
import { OpsAuthGuard, OpsViewer } from "../ops-auth.guard";
import { parse, type Viewer } from "../ops.schemas";
import { OpsTendersService } from "./ops-tenders.service";

@Public()
@UseGuards(OpsAuthGuard)
@Controller("ops/tenders")
export class OpsTendersController {
  constructor(private readonly tenders: OpsTendersService) {}

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

  @Patch(":id/assignment")
  assign(
    @OpsViewer() viewer: Viewer,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const dto = parse(z.object({ accountManagerId: z.string().uuid() }).strict(), body);
    return this.tenders.assign(viewer, id, dto.accountManagerId);
  }
}
