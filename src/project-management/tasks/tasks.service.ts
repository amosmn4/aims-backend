import { ForbiddenException, Injectable } from "@nestjs/common";
import type { TaskStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { assertDepartmentAccess } from "../../common/assert-department-access";
import { maskUserRef } from "../../common/mask-user-ref";
import { maybePaginate, type PaginationQueryDto } from "../../common/pagination";
import { DocumentsService } from "../../documents/documents.service";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateTaskDto } from "./dto/create-task.dto";
import type { UpdateTaskDto } from "./dto/update-task.dto";
import type { CreateCommentDto } from "./dto/create-comment.dto";
import type { UpdateCommentDto } from "./dto/update-comment.dto";

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
  ) {}

  // Visibility is open cross-department, same reasoning as Projects.
  findAll(
    filters: {
      projectId?: string;
      departmentId?: string;
      assigneeId?: string;
      status?: TaskStatus;
    },
    pagination: PaginationQueryDto = {},
  ) {
    return maybePaginate(
      this.prisma.task,
      {
        where: {
          ...(filters.projectId && { projectId: filters.projectId }),
          ...(filters.assigneeId && { assigneeId: filters.assigneeId }),
          ...(filters.status && { status: filters.status }),
          ...(filters.departmentId && { project: { departmentId: filters.departmentId } }),
        },
        include: {
          project: { select: { id: true, name: true, departmentId: true } },
          dependsOn: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
        },
        orderBy: [{ status: "asc" }, { position: "asc" }],
      },
      pagination,
    );
  }

  findOne(id: string) {
    return this.prisma.task.findUniqueOrThrow({
      where: { id },
      include: {
        project: true,
        dependsOn: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
      },
    });
  }

  /* ---------- Dependencies (the Gantt/WBS "depends on" graph) ---------- */

  async addDependency(taskId: string, dependsOnId: string, user: AuthenticatedUser) {
    if (taskId === dependsOnId) {
      throw new ForbiddenException("A task cannot depend on itself");
    }
    const task = await this.assertTaskAccess(taskId, user);
    const dependsOnTask = await this.prisma.task.findUniqueOrThrow({ where: { id: dependsOnId } });
    if (dependsOnTask.projectId !== task.projectId) {
      throw new ForbiddenException("Dependencies must be within the same project");
    }
    return this.prisma.taskDependency.upsert({
      where: { taskId_dependsOnId: { taskId, dependsOnId } },
      create: { taskId, dependsOnId },
      update: {},
    });
  }

  async removeDependency(taskId: string, dependsOnId: string, user: AuthenticatedUser) {
    await this.assertTaskAccess(taskId, user);
    await this.prisma.taskDependency.deleteMany({ where: { taskId, dependsOnId } });
    return { success: true };
  }

  /** Anyone assigned a task can update it directly; otherwise it's department-gated. */
  private async assertTaskAccess(taskId: string, user: AuthenticatedUser) {
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { project: { include: { department: true } } },
    });
    if (task.assigneeId === user.id) return task;
    assertDepartmentAccess(task.project.department, user);
    return task;
  }

  async create(dto: CreateTaskDto, user: AuthenticatedUser) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: dto.projectId },
      include: { department: true },
    });
    assertDepartmentAccess(project.department, user);

    return this.prisma.task.create({
      data: {
        projectId: dto.projectId,
        title: dto.title,
        description: dto.description,
        status: dto.status,
        priority: dto.priority,
        assigneeId: dto.assigneeId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        position: dto.position ?? 0,
        createdBy: user.id,
      },
    });
  }

  async update(id: string, dto: UpdateTaskDto, user: AuthenticatedUser) {
    await this.assertTaskAccess(id, user);
    return this.prisma.task.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
  }

  async remove(id: string, user: AuthenticatedUser) {
    await this.assertTaskAccess(id, user);
    await this.documentsService.deleteAllForResource("task", id);
    return this.prisma.task.delete({ where: { id } });
  }

  async listComments(taskId: string, user: AuthenticatedUser) {
    await this.assertTaskAccess(taskId, user);
    const comments = await this.prisma.taskComment.findMany({
      where: { taskId },
      include: { author: { select: { id: true, fullName: true, email: true, roles: { select: { role: true } } } } },
      orderBy: { createdAt: "asc" },
    });
    return comments.map((c) => ({ ...c, author: maskUserRef(c.author, user) }));
  }

  async createComment(taskId: string, dto: CreateCommentDto, user: AuthenticatedUser) {
    await this.assertTaskAccess(taskId, user);
    const comment = await this.prisma.taskComment.create({
      data: { taskId, authorId: user.id, body: dto.body },
      include: { author: { select: { id: true, fullName: true, email: true, roles: { select: { role: true } } } } },
    });
    return { ...comment, author: maskUserRef(comment.author, user) };
  }

  // Only the comment's own author (or an admin/CEO) may edit or delete it — task-level
  // access alone isn't enough here, since anyone on the task can read but not rewrite history.
  private async assertCommentOwnership(commentId: string, user: AuthenticatedUser) {
    const comment = await this.prisma.taskComment.findUniqueOrThrow({ where: { id: commentId } });
    const isAdminOrCeo = user.roles.includes("system_admin") || user.roles.includes("ceo");
    if (comment.authorId !== user.id && !isAdminOrCeo) {
      throw new ForbiddenException("You can only edit or delete your own comments");
    }
    return comment;
  }

  async updateComment(commentId: string, dto: UpdateCommentDto, user: AuthenticatedUser) {
    await this.assertCommentOwnership(commentId, user);
    const comment = await this.prisma.taskComment.update({
      where: { id: commentId },
      data: { body: dto.body },
      include: { author: { select: { id: true, fullName: true, email: true, roles: { select: { role: true } } } } },
    });
    return { ...comment, author: maskUserRef(comment.author, user) };
  }

  async removeComment(commentId: string, user: AuthenticatedUser) {
    await this.assertCommentOwnership(commentId, user);
    return this.prisma.taskComment.delete({ where: { id: commentId } });
  }
}
