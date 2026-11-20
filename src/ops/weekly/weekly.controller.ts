import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { Public } from "../../auth/decorators/public.decorator";
import { OpsAuthGuard, OpsViewer } from "../ops-auth.guard";
import { parse, type Viewer } from "../ops.schemas";
import { assertCeo, assertSystemAdmin } from "../ops.policy";
import { WeeklyService } from "./weekly.service";
import { WeeklyDeliveryService } from "./weekly-delivery.service";
import { AllowHtml } from "../../common/sanitize";
import { IsArray, IsBoolean, IsInt, IsObject, Min } from "class-validator";

class WeeklyAppendBody {
  @IsInt()
  @Min(1)
  version!: number;

  @AllowHtml()
  @IsArray()
  items!: unknown[];
}

class WeeklySaveBody {
  @IsInt()
  @Min(0)
  version!: number;

  @IsBoolean()
  submit!: boolean;

  @AllowHtml()
  @IsObject()
  submission!: unknown;
}

@Public()
@UseGuards(OpsAuthGuard)
@Controller("ops/weekly")
export class WeeklyController {
  constructor(
    private readonly weekly: WeeklyService,
    private readonly delivery: WeeklyDeliveryService,
  ) {}
  @Get("settings")
  settings() {
    return this.weekly.settings();
  }
  @Get("workspace")
  workspace(@OpsViewer() viewer: Viewer, @Query() query: Record<string, string>) {
    return this.weekly.workspace(viewer, query);
  }
  @Get("notifications")
  notifications(@OpsViewer() viewer: Viewer) {
    return this.weekly.notifications(viewer);
  }
  @Post("notifications/:id/read")
  @HttpCode(200)
  readNotification(@OpsViewer() viewer: Viewer, @Param("id", ParseUUIDPipe) id: string) {
    return this.weekly.readNotification(viewer, id);
  }
  @Post("submissions/:id/recall")
  @HttpCode(200)
  recall(
    @OpsViewer() viewer: Viewer,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.weekly.recall(viewer, id, body);
  }
  @Get("readiness")
  readiness(@OpsViewer() viewer: Viewer) {
    assertSystemAdmin(viewer);
    return this.delivery.readiness();
  }
  @Put("settings")
  saveSettings(@OpsViewer() viewer: Viewer, @Body() body: unknown) {
    return this.weekly.saveSettings(viewer, body);
  }
  @Get("reports")
  overview(@OpsViewer() viewer: Viewer, @Query("week") week?: string) {
    return this.weekly.overview(viewer, week);
  }
  @Get("reports/:week/:staffId")
  detail(
    @OpsViewer() viewer: Viewer,
    @Param("week") week: string,
    @Param("staffId", ParseUUIDPipe) staffId: string,
  ) {
    return this.weekly.detail(viewer, week, staffId);
  }
  @Put("reports/:week/:phase")
  save(
    @OpsViewer() viewer: Viewer,
    @Param("week") week: string,
    @Param("phase") phase: string,
    @Body() body: WeeklySaveBody,
  ) {
    return this.weekly.save(viewer, week, phase, body);
  }
  @Post("submissions/:id/review")
  @HttpCode(200)
  review(
    @OpsViewer() viewer: Viewer,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.weekly.review(viewer, id, body);
  }
  @Get("submissions")
  submissions(@OpsViewer() viewer: Viewer, @Query() query: Record<string, string>) {
    return this.weekly.submissions(viewer, query);
  }
  @Post("submissions/:id/tasks")
  @HttpCode(200)
  appendTasks(
    @OpsViewer() viewer: Viewer,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: WeeklyAppendBody,
  ) {
    return this.weekly.appendTasks(viewer, id, body);
  }
  @Delete("submissions/:id")
  deleteDraft(
    @OpsViewer() viewer: Viewer,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.weekly.deleteDraft(viewer, id, body);
  }
  @Post("submissions/:id/return")
  @HttpCode(200)
  returnForCorrection(
    @OpsViewer() viewer: Viewer,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.weekly.review(viewer, id, body, true);
  }
  @Get("submissions/:id/history")
  history(@OpsViewer() viewer: Viewer, @Param("id", ParseUUIDPipe) id: string) {
    return this.weekly.history(viewer, id);
  }
  @Get("brief")
  brief(@OpsViewer() viewer: Viewer, @Query("week") week: string, @Query("phase") phase: string) {
    return this.delivery.preview(viewer, week, phase);
  }
  @Get("deliveries")
  deliveries(@OpsViewer() viewer: Viewer) {
    return this.delivery.history(viewer);
  }
  @Post("deliveries")
  @HttpCode(200)
  send(@OpsViewer() viewer: Viewer, @Body() body: unknown) {
    assertCeo(viewer);
    const dto = parse(
      z.object({ week: z.string(), phase: z.enum(["plan", "report"]) }).strict(),
      body,
    );
    return this.delivery.sendNow(viewer, dto.week, dto.phase);
  }
  @Post("deliveries/:id/retry")
  @HttpCode(200)
  retry(
    @OpsViewer() viewer: Viewer,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    assertCeo(viewer);
    const dto = parse(z.object({ acknowledgePossibleDuplicate: z.boolean() }).strict(), body);
    return this.delivery.retry(viewer, id, dto.acknowledgePossibleDuplicate);
  }
}
