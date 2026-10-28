import { Body, Controller, Delete, Get, Post, Query, BadRequestException } from "@nestjs/common";
import { IsString, Length, Matches } from "class-validator";
import { Throttle } from "@nestjs/throttler";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { AiService } from "./ai.service";
import { AiChatService } from "./ai-chat.service";

export class AiChatDto {
  @IsString()
  @Length(1, 4000)
  message!: string;

  @IsString()
  @Matches(/^(system|water|water-report:[1-9]\d{3}-(0[1-9]|1[0-2])|report:[a-zA-Z0-9-]{1,64})$/)
  context!: string;
}

@Controller("ai")
@Roles()
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly chat: AiChatService,
  ) {}

  @Get("status")
  status() {
    return {
      configured: this.ai.providerStatus().openai,
      providers: this.ai.providerStatus(),
      scope: "All accessible business records and stored dates",
    };
  }

  @Get("chat")
  history(
    @Query("context") context = "system",
    @Query("page") page = "1",
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const number = Number(page);
    if (!Number.isSafeInteger(number) || number < 1 || number > 100000)
      throw new BadRequestException("Choose a valid conversation page.");
    return this.chat.history(context, user, number);
  }

  @Post("chat")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  send(@Body() dto: AiChatDto, @CurrentUser() user: AuthenticatedUser) {
    return this.chat.send(dto.message, dto.context, user);
  }

  @Delete("chat")
  clear(@Query("context") context = "system", @CurrentUser() user: AuthenticatedUser) {
    return this.chat.clear(context, user);
  }
}
