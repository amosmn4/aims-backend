import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { maskUserRef } from "../../common/mask-user-ref";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateTicketDto } from "./dto/create-ticket.dto";
import type { UpdateTicketDto } from "./dto/update-ticket.dto";
import type { UpdateTicketStatusDto } from "./dto/update-ticket-status.dto";

const userSelect = { id: true, fullName: true, email: true, roles: { select: { role: true } } };

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(viewer: AuthenticatedUser) {
    const tickets = await this.prisma.ticket.findMany({
      include: {
        system: { select: { id: true, name: true } },
        requester: { select: userSelect },
        assignee: { select: userSelect },
      },
      orderBy: { createdAt: "desc" },
    });
    return tickets.map((t) => this.mask(t, viewer));
  }

  async findOne(id: string, viewer: AuthenticatedUser) {
    const ticket = await this.prisma.ticket.findUniqueOrThrow({
      where: { id },
      include: {
        system: { select: { id: true, name: true } },
        requester: { select: userSelect },
        assignee: { select: userSelect },
      },
    });
    return this.mask(ticket, viewer);
  }

  private mask<T extends { requester: unknown; assignee: unknown }>(
    ticket: T,
    viewer: AuthenticatedUser,
  ) {
    type UserRef = { fullName: string | null; email: string; roles: { role: string }[] } | null;
    return {
      ...ticket,
      requester: ticket.requester ? maskUserRef(ticket.requester as NonNullable<UserRef>, viewer) : null,
      assignee: ticket.assignee ? maskUserRef(ticket.assignee as NonNullable<UserRef>, viewer) : null,
    };
  }

  create(dto: CreateTicketDto, user: AuthenticatedUser) {
    return this.prisma.ticket.create({
      data: {
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        source: dto.source,
        systemId: dto.systemId,
        requesterId: dto.requesterId,
        assigneeId: dto.assigneeId,
        createdBy: user.id,
      },
    });
  }

  update(id: string, dto: UpdateTicketDto) {
    return this.prisma.ticket.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        source: dto.source,
        systemId: dto.systemId,
        requesterId: dto.requesterId,
        assigneeId: dto.assigneeId,
      },
    });
  }

  updateStatus(id: string, dto: UpdateTicketStatusDto) {
    return this.prisma.ticket.update({
      where: { id },
      data: {
        status: dto.status,
        resolvedAt: dto.status === "resolved" || dto.status === "closed" ? new Date() : null,
      },
    });
  }

  remove(id: string) {
    return this.prisma.ticket.delete({ where: { id } });
  }
}
