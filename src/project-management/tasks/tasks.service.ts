import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { TaskStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { assertDepartmentAccess } from "../../common/assert-department-access";
import { viewerDepartmentCodes } from "../../common/department-scope";
import { maskUserRef } from "../../common/mask-user-ref";
import { maybePaginate, type PaginationQueryDto } from "../../common/pagination";
import { DocumentsService } from "../../documents/documents.service";
import { TimelineExtensionsService } from "../timeline-extensions/timeline-extensions.service";
import { NotificationsService } from "../../notifications/notifications.service";
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
    private readonly timelineExtensionsService: TimelineExtensionsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // Visibility is scoped to the viewer's own department(s) — same as Projects, including the
  // `restricted` narrowing (a task's visibility follows its parent project's — see
  // Project.visibility): excluded unless the viewer created the project, is a team member, or is
  // the task's own assignee (mirrors `assertTaskAccess`'s write-side rule). One exception:
  // filtering for your own assigned tasks ("My Tasks") is itself a safe, self-limiting signal, so
  // it's allowed to surface tasks outside your department the same way Project's `sharedWithMe`
  // does for project-level access.
  findAll(
    filters: {
      projectId?: string;
      departmentId?: string;
      assigneeId?: string;
      status?: TaskStatus;
    },
    pagination: PaginationQueryDto = {},
    viewer: AuthenticatedUser,
  ) {
    const deptCodes = viewerDepartmentCodes(viewer);
    const isOwnAssigneeFilter = !!filters.assigneeId && filters.assigneeId === viewer.id;
    const projectWhere: Record<string, unknown> = {};
    if (filters.departmentId) projectWhere.departmentId = filters.departmentId;
    if (!isOwnAssigneeFilter && deptCodes) projectWhere.department = { code: { in: deptCodes } };

    return maybePaginate(
      this.prisma.task,
      {
        where: {
          ...(filters.projectId && { projectId: filters.projectId }),
          ...(filters.assigneeId && { assigneeId: filters.assigneeId }),
          ...(filters.status && { status: filters.status }),
          ...(Object.keys(projectWhere).length > 0 && { project: projectWhere }),
          ...(!isOwnAssigneeFilter &&
            deptCodes && {
              OR: [
                { project: { visibility: "department" } },
                { project: { createdBy: viewer.id } },
                { project: { team: { some: { userId: viewer.id } } } },
                { assigneeId: viewer.id },
              ],
            }),
        },
        include: {
          project: { select: { id: true, name: true, departmentId: true } },
          dependsOn: {
            include: { dependsOn: { select: { id: true, title: true, status: true } } },
          },
        },
        orderBy: [{ status: "asc" }, { position: "asc" }],
      },
      pagination,
    );
  }

  // 404 (not 403) for an out-of-scope task, same convention as Projects.findOne.
  async findOne(id: string, viewer: AuthenticatedUser) {
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id },
      include: {
        project: { include: { department: true } },
        dependsOn: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
      },
    });
    const deptCodes = viewerDepartmentCodes(viewer);
    const needsMembershipCheck =
      !!deptCodes &&
      (!deptCodes.includes(task.project.department.code) ||
        (task.project.visibility === "restricted" && task.project.createdBy !== viewer.id)) &&
      task.assigneeId !== viewer.id;
    if (needsMembershipCheck) {
      const isTeamMember = await this.prisma.projectTeamMember.findFirst({
        where: { projectId: task.projectId, userId: viewer.id },
        select: { id: true },
      });
      if (!isTeamMember) throw new NotFoundException("Task not found");
    }
    return task;
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

    const task = await this.prisma.task.create({
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
    if (task.assigneeId && task.assigneeId !== user.id) {
      await this.notificationsService.notify({
        userId: task.assigneeId,
        type: "task_assigned",
        title: `You were assigned to: ${task.title}`,
        resourceType: "task",
        resourceId: task.id,
        createdBy: user.id,
      });
    }
    return task;
  }

  async update(id: string, dto: UpdateTaskDto, user: AuthenticatedUser) {
    const existing = await this.assertTaskAccess(id, user);
    const { extensionReason, extensionAttribution, ...rest } = dto;
    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        ...rest,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });

    if (
      dto.dueDate &&
      existing.dueDate &&
      new Date(dto.dueDate).getTime() > existing.dueDate.getTime() &&
      extensionReason &&
      extensionAttribution
    ) {
      await this.timelineExtensionsService.create({
        entityType: "task",
        entityId: id,
        previousDate: existing.dueDate,
        newDate: new Date(dto.dueDate),
        reason: extensionReason,
        attributedTo: extensionAttribution,
        createdBy: user.id,
      });
    }

    if (dto.assigneeId && dto.assigneeId !== existing.assigneeId && dto.assigneeId !== user.id) {
      await this.notificationsService.notify({
        userId: dto.assigneeId,
        type: "task_assigned",
        title: `You were assigned to: ${updated.title}`,
        resourceType: "task",
        resourceId: id,
        createdBy: user.id,
      });
    }
    return updated;
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
      include: {
        author: {
          select: { id: true, fullName: true, email: true, roles: { select: { role: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return comments.map((c) => ({ ...c, author: maskUserRef(c.author, user) }));
  }

  async createComment(taskId: string, dto: CreateCommentDto, user: AuthenticatedUser) {
    const task = await this.assertTaskAccess(taskId, user);
    const comment = await this.prisma.taskComment.create({
      data: { taskId, authorId: user.id, body: dto.body },
      include: {
        author: {
          select: { id: true, fullName: true, email: true, roles: { select: { role: true } } },
        },
      },
    });
    if (task.assigneeId && task.assigneeId !== user.id) {
      await this.notificationsService.notify({
        userId: task.assigneeId,
        type: "task_comment",
        title: `New comment on: ${task.title}`,
        body: dto.body,
        resourceType: "task",
        resourceId: taskId,
        createdBy: user.id,
      });
    }
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
      include: {
        author: {
          select: { id: true, fullName: true, email: true, roles: { select: { role: true } } },
        },
      },
    });
    return { ...comment, author: maskUserRef(comment.author, user) };
  }

  async removeComment(commentId: string, user: AuthenticatedUser) {
    await this.assertCommentOwnership(commentId, user);
    return this.prisma.taskComment.delete({ where: { id: commentId } });
  }
}
