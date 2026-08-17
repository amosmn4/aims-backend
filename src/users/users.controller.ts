import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { parsePaginationQuery } from "../common/pagination";

@Controller("users")
@Roles("system_admin")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Overrides the class-level @Roles("system_admin") with no required roles, so any
  // authenticated staff member can populate account-manager-style dropdowns. System admins
  // are filtered out of the result in the service unless the caller is one themselves.
  @Get("lite")
  @Roles()
  findAllLite(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findAllLite(user);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.usersService.findAll(user, parsePaginationQuery(page, pageSize));
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.create(dto, user);
  }

  @Post(":id/resend-invite")
  resendInvite(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.resendInvite(id, user);
  }

  @Post(":id/reset-password")
  resetPassword(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.resetPassword(id, user);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.update(id, dto, user);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.remove(id, user);
  }
}
