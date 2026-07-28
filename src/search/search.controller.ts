import { Controller, Get, Query } from "@nestjs/common";
import { SearchService } from "./search.service";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

@Controller("search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Roles()
  search(@Query("q") q: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.searchService.search(q, user);
  }
}
