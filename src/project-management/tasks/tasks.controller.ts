import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { TaskStatus } from "@prisma/client";
import { TasksService } from "./tasks.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { UpdateCommentDto } from "./dto/update-comment.dto";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import { parsePaginationQuery } from "../../common/pagination";

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @Roles()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("projectId") projectId?: string,
    @Query("departmentId") departmentId?: string,
    @Query("assigneeId") assigneeId?: string,
    @Query("status") status?: TaskStatus,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.tasksService.findAll(
      { projectId, departmentId, assigneeId, status },
      parsePaginationQuery(page, pageSize),
      user,
    );
  }

  @Get(":id")
  @Roles()
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.findOne(id, user);
  }

  @Post()
  @Roles("finance", "hr", "it", "marketing", "tender")
  create(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.create(dto, user);
  }

  // No static @Roles restriction beyond "authenticated" — TasksService.assertTaskAccess
  // allows the assignee through regardless of department, matching the spec's
  // cross-department collaboration model.
  @Patch(":id")
  @Roles()
  update(
    @Param("id") id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.update(id, dto, user);
  }

  @Delete(":id")
  @Roles()
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.remove(id, user);
  }

  @Get(":id/comments")
  @Roles()
  listComments(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.listComments(id, user);
  }

  @Post(":id/comments")
  @Roles()
  createComment(
    @Param("id") id: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.createComment(id, dto, user);
  }

  @Patch("comments/:commentId")
  @Roles()
  updateComment(
    @Param("commentId") commentId: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.updateComment(commentId, dto, user);
  }

  @Delete("comments/:commentId")
  @Roles()
  removeComment(@Param("commentId") commentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.removeComment(commentId, user);
  }

  @Post(":id/dependencies/:dependsOnId")
  @Roles()
  addDependency(
    @Param("id") id: string,
    @Param("dependsOnId") dependsOnId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.addDependency(id, dependsOnId, user);
  }

  @Delete(":id/dependencies/:dependsOnId")
  @Roles()
  removeDependency(
    @Param("id") id: string,
    @Param("dependsOnId") dependsOnId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.removeDependency(id, dependsOnId, user);
  }
}
