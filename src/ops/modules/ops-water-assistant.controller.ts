import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AiService } from "../../ai/ai.service";
import { AiChatService } from "../../ai/ai-chat.service";
import { AiChatDto } from "../../ai/ai.controller";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Public } from "../../auth/decorators/public.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { OpsAuthGuard } from "../ops-auth.guard";
import { OpsFeature, OpsFeatureRead, OpsModuleGuard } from "../ops-module.guard";

function waterContext(context: string) {
  if (!/^(water|water-report:[1-9]\d{3}-(0[1-9]|1[0-2]))$/.test(context))
    throw new BadRequestException("Choose a Water conversation.");
  return context;
}

@Public()
@UseGuards(OpsAuthGuard, OpsModuleGuard)
@OpsFeature("water")
@Controller("ops/water/assistant")
export class OpsWaterAssistantController {
  constructor(
    private readonly ai: AiService,
    private readonly chat: AiChatService,
  ) {}

  @Get("status")
  status() {
    return {
      configured: this.ai.providerStatus().openai,
      providers: this.ai.providerStatus(),
      scope: "Water records and stored dates",
    };
  }

  @Get("chat")
  history(
    @Query("context") context = "water",
    @Query("page") page = "1",
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const number = Number(page);
    if (!Number.isSafeInteger(number) || number < 1 || number > 100000)
      throw new BadRequestException("Choose a valid conversation page.");
    return this.chat.history(waterContext(context), user, number);
  }

  @Post("chat")
  @OpsFeatureRead()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  send(@Body() dto: AiChatDto, @CurrentUser() user: AuthenticatedUser) {
    return this.chat.send(dto.message, waterContext(dto.context), user);
  }

  @Delete("chat")
  @OpsFeatureRead()
  clear(@Query("context") context = "water", @CurrentUser() user: AuthenticatedUser) {
    return this.chat.clear(waterContext(context), user);
  }
}
