import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { maskUserRef } from "../common/mask-user-ref";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

export interface ThreadReply {
  /** Everyone who wrote in the thread; the actor is skipped automatically. */
  participantIds: (string | null | undefined)[];
  actor: AuthenticatedUser;
  /** Where the reply was posted, in words: `tender "Supply of laptops"`. */
  where: string;
  body: string;
  resourceType: string;
  resourceId: string;
}

// Shared rules for reply threads on comments, activities, follow-ups and tickets.
@Injectable()
export class ThreadsService {
  private readonly logger = new Logger(ThreadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Replies attach to the first message of a thread, so threads stay one level deep. */
  rootOf(parent: { id: string; parentId: string | null } | null, belongsToRecord: boolean) {
    if (!parent || !belongsToRecord) {
      throw new BadRequestException("You can only reply to a message on this record");
    }
    return parent.parentId ?? parent.id;
  }

  async notifyReply(reply: ThreadReply) {
    const recipients = [
      ...new Set(reply.participantIds.filter((id): id is string => !!id && id !== reply.actor.id)),
    ];
    if (recipients.length === 0) return;
    const author = await this.prisma.user.findUnique({
      where: { id: reply.actor.id },
      select: { id: true, fullName: true, email: true, roles: { select: { role: true } } },
    });
    await Promise.all(
      recipients.map(async (userId) => {
        try {
          const viewer = await this.viewerFor(userId);
          const name = author && viewer ? maskUserRef(author, viewer) : null;
          await this.notifications.notify({
            userId,
            type: "comment_reply",
            title: `${name?.fullName || name?.email || "Someone"} replied on ${reply.where}`,
            body: reply.body.slice(0, 200),
            resourceType: reply.resourceType,
            resourceId: reply.resourceId,
            createdBy: reply.actor.id,
          });
        } catch (err) {
          this.logger.warn(
            `Reply notification failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }),
    );
  }

  private async viewerFor(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, departmentId: true, roles: { select: { role: true } } },
    });
    return user
      ? {
          id: user.id,
          email: user.email,
          departmentId: user.departmentId,
          roles: user.roles.map((r) => r.role),
        }
      : null;
  }
}
