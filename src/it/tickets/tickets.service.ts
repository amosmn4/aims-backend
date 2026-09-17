import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, TicketStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { ThreadsService } from "../../threads/threads.service";
import { maskUserRef } from "../../common/mask-user-ref";
import { canWriteModule } from "../../common/module-access";
import { maybePaginate, type PaginationQueryDto } from "../../common/pagination";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateTicketDto } from "./dto/create-ticket.dto";
import type { UpdateTicketDto } from "./dto/update-ticket.dto";
import type { UpdateTicketStatusDto } from "./dto/update-ticket-status.dto";
import type { TicketCommentDto } from "./dto/ticket-comment.dto";

const userSelect = {
  id: true,
  fullName: true,
  email: true,
  roles: { select: { role: true } },
} as const;
const INCLUDE = {
  system: { select: { id: true, name: true } },
  requester: { select: userSelect },
  assignee: { select: userSelect },
  _count: { select: { comments: true } },
} as const;
const STATUS_WORDS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export interface TicketFilters {
  status?: string;
  assigneeId?: string;
  mine?: boolean;
  q?: string;
}

type UserRef = { id: string; fullName: string | null; email: string; roles: { role: string }[] };

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly threads: ThreadsService,
  ) {}

  /** IT staff and the CEO handle tickets; everyone else raises and follows their own. */
  private isHandler(user: AuthenticatedUser) {
    return canWriteModule("it", user, this.prisma);
  }

  private async visibleWhere(user: AuthenticatedUser): Promise<Prisma.TicketWhereInput> {
    if (await this.isHandler(user)) return {};
    return { OR: [{ requesterId: user.id }, { createdBy: user.id }, { assigneeId: user.id }] };
  }

  async findAll(
    viewer: AuthenticatedUser,
    filters: TicketFilters = {},
    pagination: PaginationQueryDto = {},
  ) {
    const statuses: TicketStatus[] = ["open", "in_progress", "resolved", "closed"];
    const status = statuses.find((s) => s === filters.status);
    const q = filters.q?.trim();
    const result = await maybePaginate(
      this.prisma.ticket,
      {
        where: {
          AND: [
            await this.visibleWhere(viewer),
            status ? { status } : {},
            filters.assigneeId ? { assigneeId: filters.assigneeId } : {},
            filters.mine
              ? {
                  OR: [
                    { requesterId: viewer.id },
                    { createdBy: viewer.id },
                    { assigneeId: viewer.id },
                  ],
                }
              : {},
            q ? { OR: [{ title: { contains: q } }, { description: { contains: q } }] } : {},
          ],
        },
        include: INCLUDE,
        orderBy: { createdAt: "desc" },
      },
      pagination,
    );
    type Row = { requester: UserRef | null; assignee: UserRef | null };
    const rows = (Array.isArray(result) ? result : result.data) as unknown as Row[];
    const data = rows.map((t) => this.mask(t, viewer));
    return Array.isArray(result) ? data : { ...result, data };
  }

  async findOne(id: string, viewer: AuthenticatedUser) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { AND: [{ id }, await this.visibleWhere(viewer)] },
      include: INCLUDE,
    });
    if (!ticket)
      throw new NotFoundException("This ticket doesn't exist or you don't have access to it");
    const handler = await this.isHandler(viewer);
    return {
      ...this.mask(ticket, viewer),
      canManage: handler,
      canEditDetails: handler || (ticket.requesterId === viewer.id && ticket.status === "open"),
    };
  }

  async create(dto: CreateTicketDto, user: AuthenticatedUser) {
    const handler = await this.isHandler(user);
    const ticket = await this.prisma.ticket.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        priority: dto.priority,
        source: handler ? dto.source : "internal",
        systemId: dto.systemId,
        requesterId: handler ? (dto.requesterId ?? user.id) : user.id,
        assigneeId: handler ? dto.assigneeId : undefined,
        createdBy: user.id,
      },
      include: INCLUDE,
    });
    if (!handler) {
      const itStaff = await this.prisma.user.findMany({
        where: { isActive: true, roles: { some: { role: "it" } } },
        select: { id: true },
      });
      await this.notifyAll(
        itStaff.map((u) => u.id),
        user,
        {
          title: `New IT request: ${ticket.title}`,
          body: ticket.description ?? undefined,
          ticketId: ticket.id,
        },
      );
    } else if (ticket.assigneeId) {
      await this.notifyAll([ticket.assigneeId], user, {
        title: `IT ticket given to you: ${ticket.title}`,
        ticketId: ticket.id,
      });
    }
    return this.mask(ticket, user);
  }

  async update(id: string, dto: UpdateTicketDto, user: AuthenticatedUser) {
    const existing = await this.prisma.ticket.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Ticket not found");
    const handler = await this.isHandler(user);
    const ownOpen = existing.requesterId === user.id && existing.status === "open";
    if (!handler && !ownOpen) {
      throw new ForbiddenException("Only IT can change this ticket once work has started");
    }
    const ticket = await this.prisma.ticket.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        priority: dto.priority,
        systemId: dto.systemId,
        ...(handler && {
          source: dto.source,
          requesterId: dto.requesterId,
          assigneeId: dto.assigneeId,
        }),
      },
      include: INCLUDE,
    });
    if (handler && dto.assigneeId && dto.assigneeId !== existing.assigneeId) {
      await this.notifyAll([dto.assigneeId], user, {
        title: `IT ticket given to you: ${ticket.title}`,
        ticketId: id,
      });
    }
    return this.mask(ticket, user);
  }

  async updateStatus(id: string, dto: UpdateTicketStatusDto, user: AuthenticatedUser) {
    if (!(await this.isHandler(user))) throw new ForbiddenException("Only IT can move a ticket");
    const existing = await this.prisma.ticket.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Ticket not found");
    const done = dto.status === "resolved" || dto.status === "closed";
    const ticket = await this.prisma.ticket.update({
      where: { id },
      data: {
        status: dto.status,
        resolvedAt: done ? (existing.resolvedAt ?? new Date()) : null,
        closedAt: dto.status === "closed" ? (existing.closedAt ?? new Date()) : null,
      },
      include: INCLUDE,
    });
    if (existing.status !== dto.status) {
      await this.notifyAll([existing.requesterId, existing.createdBy], user, {
        title: `Your IT request is now ${STATUS_WORDS[dto.status].toLowerCase()}: ${ticket.title}`,
        ticketId: id,
      });
    }
    return this.mask(ticket, user);
  }

  async remove(id: string, user: AuthenticatedUser) {
    if (!(await this.isHandler(user))) throw new ForbiddenException("Only IT can delete tickets");
    return this.prisma.ticket.delete({ where: { id } });
  }

  async listComments(ticketId: string, viewer: AuthenticatedUser) {
    await this.findOne(ticketId, viewer);
    const comments = await this.prisma.ticketComment.findMany({
      where: { ticketId },
      include: { author: { select: userSelect } },
      orderBy: { createdAt: "asc" },
    });
    return comments.map((c) => ({ ...c, author: maskUserRef(c.author, viewer) }));
  }

  async addComment(ticketId: string, dto: TicketCommentDto, user: AuthenticatedUser) {
    const ticket = await this.findOne(ticketId, user);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException("Write a message first");
    const parent = dto.parentId
      ? await this.prisma.ticketComment.findUnique({
          where: { id: dto.parentId },
          select: { id: true, parentId: true, ticketId: true },
        })
      : null;
    const parentId = dto.parentId
      ? this.threads.rootOf(parent, parent?.ticketId === ticketId)
      : null;
    const comment = await this.prisma.ticketComment.create({
      data: { ticketId, authorId: user.id, body, parentId },
      include: { author: { select: userSelect } },
    });
    if (parentId) {
      const thread = await this.prisma.ticketComment.findMany({
        where: { OR: [{ id: parentId }, { parentId }] },
        select: { authorId: true },
      });
      await this.threads.notifyReply({
        participantIds: [...thread.map((t) => t.authorId), ticket.requesterId, ticket.assigneeId],
        actor: user,
        where: `IT ticket "${ticket.title}"`,
        body,
        resourceType: "ticket",
        resourceId: ticketId,
      });
    } else {
      await this.notifyAll([ticket.requesterId, ticket.assigneeId, ticket.createdBy], user, {
        title: `New message on IT ticket: ${ticket.title}`,
        body,
        ticketId,
      });
    }
    return { ...comment, author: maskUserRef(comment.author, user) };
  }

  async removeComment(commentId: string, user: AuthenticatedUser) {
    const comment = await this.prisma.ticketComment.findUnique({ where: { id: commentId } });
    if (!comment) throw new NotFoundException("Message not found");
    if (comment.authorId !== user.id && !(await this.isHandler(user))) {
      throw new ForbiddenException("You can only delete your own messages");
    }
    await this.prisma.ticketComment.delete({ where: { id: commentId } });
    return { id: commentId };
  }

  private async notifyAll(
    userIds: (string | null | undefined)[],
    actor: AuthenticatedUser,
    event: { title: string; body?: string; ticketId: string },
  ) {
    const recipients = [...new Set(userIds.filter((id): id is string => !!id && id !== actor.id))];
    await Promise.all(
      recipients.map((userId) =>
        this.notifications.notify({
          userId,
          type: "ticket_update",
          title: event.title,
          body: event.body?.slice(0, 200),
          resourceType: "ticket",
          resourceId: event.ticketId,
          createdBy: actor.id,
        }),
      ),
    );
  }

  private mask<T extends { requester: UserRef | null; assignee: UserRef | null }>(
    ticket: T,
    viewer: AuthenticatedUser,
  ) {
    return {
      ...ticket,
      requester: ticket.requester ? maskUserRef(ticket.requester, viewer) : null,
      assignee: ticket.assignee ? maskUserRef(ticket.assignee, viewer) : null,
    };
  }
}
