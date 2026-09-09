import { Body, Controller, Delete, Get, Post, Query } from "@nestjs/common";
import { WaterAiService } from "./water-ai.service";
import { GenerateInsightDto } from "./dto/generate-insight.dto";
import { SendChatMessageDto } from "./dto/send-chat-message.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

// Same access as the rest of the water module — AI surfaces the same data, just in natural language.
@Controller("water/ai")
@Roles("water")
export class WaterAiController {
  constructor(private readonly waterAi: WaterAiService) {}

  @Get("status")
  status() {
    return { configured: this.waterAi.isConfigured(), providers: this.waterAi.providerStatus() };
  }

  @Get("insights")
  latestInsight(@Query("month") month?: string) {
    return this.waterAi.latestInsight(month);
  }

  @Post("insights/generate")
  generateInsight(@Body() dto: GenerateInsightDto, @CurrentUser() user: AuthenticatedUser) {
    return this.waterAi.generateInsight(dto.month, user);
  }

  @Get("chat")
  chatHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.waterAi.chatHistory(user);
  }

  @Post("chat")
  sendChat(@Body() dto: SendChatMessageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.waterAi.chatSend(dto.message, user);
  }

  @Delete("chat")
  clearChat(@CurrentUser() user: AuthenticatedUser) {
    return this.waterAi.clearChat(user);
  }
}
