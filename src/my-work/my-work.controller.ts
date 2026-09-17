import { Controller, Get } from "@nestjs/common";
import { MyWorkService } from "./my-work.service";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

@Controller("my-work")
@Roles()
export class MyWorkController {
  constructor(private readonly myWork: MyWorkService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.myWork.forUser(user);
  }
}
