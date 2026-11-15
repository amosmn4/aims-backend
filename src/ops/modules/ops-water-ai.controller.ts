import { UseGuards } from "@nestjs/common";
import { Public } from "../../auth/decorators/public.decorator";
import { OpsAuthGuard } from "../ops-auth.guard";
import { OpsFeature, OpsFeatureRead, OpsModuleGuard } from "../ops-module.guard";
import { Body, Controller, Delete, Get, Post, Query } from "@nestjs/common";
import { WaterAiService } from "../../water/water-ai.service";
import { GenerateInsightDto } from "../../water/dto/generate-insight.dto";
import { SendChatMessageDto } from "../../water/dto/send-chat-message.dto";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
@Public()
@UseGuards(OpsAuthGuard, OpsModuleGuard)
@OpsFeature("water")
@Controller("ops/water/ai")
export class OpsWaterAiController {
  constructor(private readonly waterAi: WaterAiService) {}
  @Get("status")
  status() {
    return { configured: this.waterAi.isConfigured(), providers: this.waterAi.providerStatus() };
  }
  @Get("insights")
  latestInsight(
    @Query("month")
    month?: string,
  ) {
    return this.waterAi.latestInsight(month);
  }
  @Post("insights/generate")
  generateInsight(
    @Body()
    dto: GenerateInsightDto,
    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.waterAi.generateInsight(dto.month, user);
  }
  @Get("chat")
  chatHistory(
    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.waterAi.chatHistory(user);
  }
  @OpsFeatureRead()
  @Post("chat")
  sendChat(
    @Body()
    dto: SendChatMessageDto,
    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.waterAi.chatSend(dto.message, user);
  }
  @OpsFeatureRead()
  @Delete("chat")
  clearChat(
    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.waterAi.clearChat(user);
  }
}
