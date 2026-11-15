import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../notifications/email/email.service";
import { StorageService } from "../storage/storage.service";
import { sanitizeRichText } from "../common/sanitize";
import { hashToken } from "./ops-auth.service";
import { OpsRepository, type OpsTransaction } from "./ops.repository";
import { weeklySubmissionSchema } from "./weekly/weekly.schemas";
import {
  assertCeo,
  assertSystemAdmin,
  authorizeWrite,
  canReadDocument,
  validateWorkspace,
  visibleWorkspace,
} from "./ops.policy";
import {
  inviteSchema,
  parse,
  schemas,
  settingsSchema,
  type Collection,
  type Records,
  type Viewer,
  type Workspace,
} from "./ops.schemas";

@Injectable()
export class OpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: OpsRepository,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly storage: StorageService,
  ) {}

  async workspace(viewer: Viewer) {
    const initialized = await this.prisma.opsState.findUnique({ where: { id: "workspace" } });
    if (!initialized)
      throw new ServiceUnavailableException(
        "Ops is not initialized. Run the Ops bootstrap command.",
      );
    return this.prisma.$transaction(
      async (db) => {
        await this.assertCurrentAccess(db, viewer);
        const data = await this.repository.load(db);
        return { workspace: visibleWorkspace(viewer, data.workspace), revision: data.revision };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async mutate<T>(
    viewer: Viewer,
    revision: number,
    action: (db: OpsTransaction, data: Workspace) => Promise<T>,
  ) {
    try {
      return await this.prisma.$transaction(
        async (db) => {
          const changed = await db.opsState.updateMany({
            where: { id: "workspace", revision },
            data: { revision: { increment: 1 } },
          });
          if (!changed.count)
            throw new ConflictException(
              "The workspace changed. Reload it and review your changes before saving again.",
            );
          await this.assertCurrentAccess(db, viewer);
          const { workspace } = await this.repository.load(db);
          return action(db, workspace);
        },
        { maxWait: 10000, timeout: 15000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2003")
          throw new BadRequestException(
            "This record is still linked to other records. Remove those links first.",
          );
        if (error.code === "P2002")
          throw new ConflictException("A record with these details already exists.");
        if (error.code === "P2034")
          throw new ConflictException("Another change was saved. Reload and try again.");
      }
      throw error;
    }
  }

  async save<K extends Collection>(
    viewer: Viewer,
    collection: K,
    value: unknown,
    revision: number,
  ) {
    const record = parse(schemas[collection] as unknown as z.ZodType<Records[K]>, value);
    if (collection === "projects") {
      const project = record as Records["projects"];
      project.summary = sanitizeRichText(project.summary);
      if (!project.summary.trim())
        throw new BadRequestException("Project summary must contain readable content.");
    } else if (collection === "tasks") {
      const task = record as Records["tasks"];
      task.description = sanitizeRichText(task.description) ?? undefined;
    }
    return this.mutate(viewer, revision, async (db, data) => {
      const previous = (data[collection] as Records[K][]).find((row) => row.id === record.id);
      authorizeWrite(viewer, collection, record, previous, data);
      if (collection === "documents") {
        if (!previous) throw new BadRequestException("Use Upload document to attach a file.");
        const doc = record as Records["documents"];
        const old = previous as Records["documents"];
        if (
          doc.owner !== old.owner ||
          doc.fileKey !== old.fileKey ||
          doc.mime !== old.mime ||
          doc.task !== old.task ||
          doc.weeklyRef !== old.weeklyRef
        )
          throw new BadRequestException(
            "File ownership, content and attachment association cannot be changed through document metadata.",
          );
        if (
          old.weeklyRef &&
          (doc.access !== "restricted" || doc.allowed?.some((personId) => personId !== old.owner))
        )
          throw new BadRequestException(
            "Weekly attachments must remain private to their author and the CEO.",
          );
      }
      if (collection === "tasks" && viewer.role !== "ceo") {
        const task = record as Records["tasks"];
        const old = previous as Records["tasks"] | undefined;
        if (task.ceoComment !== old?.ceoComment)
          throw new BadRequestException("Only the CEO can add or change a task comment.");
      }
      if (collection === "reports") {
        const report = record as Records["reports"];
        const old = previous as Records["reports"] | undefined;
        if (old?.reviewed)
          throw new BadRequestException("Reviewed reports are locked. Submit a new update.");
        if (report.reviewed || report.comment)
          throw new BadRequestException("Use the report review action to record a review.");
        if (old && old.author !== report.author)
          throw new BadRequestException("Report authors cannot be changed.");
      }
      const next = {
        ...data,
        [collection]: [
          ...(data[collection] as Records[K][]).filter((row) => row.id !== record.id),
          record,
        ],
      };
      validateWorkspace(next);
      await this.repository.save(db, collection, record);
      await this.audit(
        db,
        viewer,
        `ops.${collection}.${previous ? "updated" : "created"}`,
        record.id,
        previous,
        record,
      );
      return { id: record.id };
    });
  }

  async remove(viewer: Viewer, collection: Collection, id: string, revision: number) {
    const storageKeys: string[] = [];
    await this.mutate(viewer, revision, async (db, data) => {
      const previous = data[collection].find((row) => row.id === id);
      if (!previous) throw new NotFoundException("Record not found.");
      authorizeWrite(viewer, collection, previous, previous, data, true);
      if (collection === "departments" || (collection === "businesses" && id === "b0"))
        throw new BadRequestException("This workspace record cannot be deleted.");
      if (collection === "reports" && (previous as Records["reports"]).reviewed)
        throw new BadRequestException("Reviewed reports are retained for review history.");
      validateWorkspace({
        ...data,
        [collection]: data[collection].filter((row) => row.id !== id),
        ...(collection === "tasks"
          ? { documents: data.documents.filter((document) => document.task !== id) }
          : {}),
      });
      if (collection === "documents") {
        const document = previous as Records["documents"];
        if (document.weeklyRef) {
          const [, staffId, weekStart, phase] = document.weeklyRef.split(":");
          if (staffId && weekStart && (phase === "plan" || phase === "report")) {
            const weekly = await db.opsWeeklyReport.findUnique({
              where: {
                staffId_weekStart_phase: { staffId, weekStart, phase },
              },
              select: { submission: true },
            });
            const submission = weekly && weeklySubmissionSchema.safeParse(weekly.submission);
            if (submission?.success && submission.data.attachments?.includes(id))
              throw new BadRequestException(
                "Weekly submission attachments must be removed from an editable draft first.",
              );
          }
        }
        storageKeys.push((await db.opsDocument.findUniqueOrThrow({ where: { id } })).storageKey);
      } else if (collection === "tasks") {
        const attachments = await db.opsDocument.findMany({
          where: { task: id },
          select: { id: true, storageKey: true },
        });
        storageKeys.push(...attachments.map((document) => document.storageKey));
        await db.opsDocument.deleteMany({ where: { task: id } });
        for (const document of attachments)
          await this.audit(db, viewer, "ops.documents.deleted", document.id);
      }
      await this.repository.remove(db, collection, id);
      await this.audit(db, viewer, `ops.${collection}.deleted`, id, previous);
    });
    await Promise.all(storageKeys.map((key) => this.storage.delete(key)));
    return { success: true };
  }

  review(viewer: Viewer, id: string, comment: string | undefined, revision: number) {
    assertCeo(viewer);
    return this.mutate(viewer, revision, async (db, data) => {
      const report = data.reports.find((row) => row.id === id);
      if (!report) throw new NotFoundException("Report not found.");
      if (report.reviewed) throw new ConflictException("This report has already been reviewed.");
      await db.opsReportReview.create({
        data: { reportId: id, reviewerId: viewer.id, comment: comment?.trim() || null },
      });
      await db.opsReport.update({
        where: { id },
        data: { reviewed: true, comment: comment?.trim() || null },
      });
      await this.audit(db, viewer, "ops.reports.reviewed", id, report, {
        ...report,
        reviewed: true,
        comment,
      });
      return { success: true };
    });
  }

  commentTask(viewer: Viewer, id: string, comment: string, revision: number) {
    assertCeo(viewer);
    return this.mutate(viewer, revision, async (db, data) => {
      const task = data.tasks.find((row) => row.id === id);
      if (!task) throw new NotFoundException("Task not found.");
      const ceoComment = comment.trim() || null;
      await db.opsTask.update({ where: { id }, data: { ceoComment } });
      await this.audit(db, viewer, "ops.tasks.commented", id, task.ceoComment, ceoComment);
      return { success: true };
    });
  }

  async reviewHistory(viewer: Viewer, id: string) {
    const { workspace } = await this.workspace(viewer);
    if (!workspace.reports.some((report) => report.id === id))
      throw new NotFoundException("Report not found.");
    return this.prisma.opsReportReview.findMany({
      where: { reportId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, reviewerId: true, comment: true, createdAt: true },
    });
  }

  settings(viewer: Viewer, value: unknown, revision: number) {
    assertCeo(viewer);
    const settings = parse(settingsSchema, value);
    return this.mutate(viewer, revision, async (db, data) => {
      await db.opsState.update({ where: { id: "workspace" }, data: { settings } });
      await this.audit(db, viewer, "ops.settings.updated", "workspace", data.settings, settings);
      return { success: true };
    });
  }

  account(viewer: Viewer, id: string, role: "ceo" | "staff", active: boolean, revision: number) {
    if (role === "ceo") assertSystemAdmin(viewer);
    else if (viewer.role !== "ceo" && viewer.role !== "system_admin")
      throw new ForbiddenException("CEO or system administrator access is required.");
    return this.mutate(viewer, revision, async (db, data) => {
      const previous = data.accounts.find((row) => row.id === id);
      if (!previous) throw new NotFoundException("Account not found.");
      if (previous.role === "system_admin")
        throw new BadRequestException(
          "System administrator accounts are managed through bootstrap.",
        );
      if (viewer.role === "ceo" && previous.role !== "staff")
        throw new BadRequestException("CEO account assignments are managed by System Admin.");
      if (role === "ceo" && (!active || !previous.hasPassword))
        throw new BadRequestException("The CEO must have an active account and password.");
      if (viewer.role === "system_admin" && id === viewer.id)
        throw new BadRequestException(
          "Your system administrator profile is managed through bootstrap.",
        );
      validateWorkspace({
        ...data,
        accounts: data.accounts.map((row) => {
          if (row.id === id) return { ...row, role, active };
          if (viewer.role === "system_admin" && role === "ceo" && row.role === "ceo")
            return { ...row, role: "staff" };
          return row;
        }),
      });
      if (viewer.role === "system_admin" && role === "ceo")
        await db.opsStaff.updateMany({
          where: { role: "ceo", id: { not: id } },
          data: { role: "staff" },
        });
      await db.opsStaff.update({ where: { id }, data: { role, active } });
      if (!active) await db.opsSession.deleteMany({ where: { staffId: id } });
      await this.audit(
        db,
        viewer,
        "ops.accounts.updated",
        id,
        { role: previous.role, active: previous.active },
        { role, active },
      );
      return { success: true };
    });
  }

  businessPermissions(
    viewer: Viewer,
    person: string,
    home: string | null,
    grants: string[],
    revision: number,
  ) {
    assertCeo(viewer);
    return this.mutate(viewer, revision, async (db, data) => {
      const next = {
        ...data,
        staffBusiness: [
          ...data.staffBusiness.filter((row) => row.person !== person),
          ...(home ? [{ person, business: home }] : []),
        ],
        businessAccess: [
          ...data.businessAccess.filter((row) => row.person !== person),
          ...grants.map((business) => ({ person, business })),
        ],
      };
      validateWorkspace(next);
      await db.opsBusinessGrant.deleteMany({ where: { personId: person } });
      const rows = [
        ...grants.map((businessId) => ({ personId: person, businessId, kind: "grant" })),
        ...(home ? [{ personId: person, businessId: home, kind: "home" }] : []),
      ];
      if (rows.length) await db.opsBusinessGrant.createMany({ data: rows });
      await this.audit(db, viewer, "ops.business_permissions.updated", person, undefined, {
        home,
        grants,
      });
      return { success: true };
    });
  }

  private frontendUrl() {
    const raw = this.config.get<string>("OPS_FRONTEND_URL");
    if (!raw)
      throw new ServiceUnavailableException("Set OPS_FRONTEND_URL before issuing invitations.");
    const url = new URL(raw);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      (this.config.get("NODE_ENV") === "production" && url.protocol !== "https:")
    )
      throw new ServiceUnavailableException("OPS_FRONTEND_URL must be an HTTPS URL in production.");
    return url.origin;
  }

  async invite(viewer: Viewer, value: unknown, revision: number) {
    const dto = parse(inviteSchema, value);
    if (
      (viewer.role === "ceo" && dto.role !== "staff") ||
      (viewer.role === "system_admin" && dto.role !== "ceo") ||
      (viewer.role !== "ceo" && viewer.role !== "system_admin")
    )
      throw new ForbiddenException("You cannot invite an account with this role.");
    const origin = this.frontendUrl();
    const token = randomBytes(32).toString("hex");
    const result = await this.mutate(viewer, revision, async (db, data) => {
      let person = dto.personId ? data.people.find((row) => row.id === dto.personId) : undefined;
      if (dto.personId && !person) throw new NotFoundException("Staff member not found.");
      if (!person)
        person = parse(schemas.people, {
          id: randomUUID(),
          name: dto.name,
          title: dto.title,
          dept: dto.dept ?? null,
        });
      if (data.accounts.some((account) => account.personId === person.id))
        throw new BadRequestException("This staff member already has an account.");
      let user = await db.user.findUnique({ where: { email: dto.email } });
      if (user && !user.isActive)
        throw new BadRequestException(
          "The shared identity is inactive. Resolve this through the existing account administration.",
        );
      if (user && (await db.opsStaff.findUnique({ where: { userId: user.id } })))
        throw new BadRequestException("This email already has Ops access.");
      if (!user)
        user = await db.user.create({
          data: { email: dto.email, fullName: person.name, jobTitle: person.title },
        });
      await db.opsStaff.upsert({
        where: { id: person.id },
        create: { ...person, userId: user.id, role: dto.role },
        update: { userId: user.id, role: dto.role, active: true },
      });
      await db.opsInvitation.create({
        data: {
          staffId: person.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
      await this.audit(db, viewer, "ops.staff.invited", person.id, undefined, {
        email: dto.email,
        role: dto.role,
      });
      return { email: dto.email };
    });
    const invitationUrl = `${origin}/login?token=${token}`;
    const emailSent = await this.email.send(
      result.email,
      "Amsol Ops invitation",
      `<p>You have been invited to Amsol Ops.</p><p><a href="${invitationUrl}">Set up your account</a></p><p>This link expires in 7 days.</p>`,
    );
    return { invitationUrl, emailSent };
  }

  async renewInvitation(viewer: Viewer, id: string, revision: number) {
    assertCeo(viewer);
    if (id === viewer.id)
      throw new BadRequestException("Use My account to change your own password.");
    const origin = this.frontendUrl();
    const token = randomBytes(32).toString("hex");
    const result = await this.mutate(viewer, revision, async (db) => {
      const staff = await db.opsStaff.findUnique({
        where: { id },
        include: { user: { select: { email: true, isActive: true } } },
      });
      if (!staff?.user?.isActive || !staff.active)
        throw new BadRequestException("Activate the Ops account before renewing its invitation.");
      await db.opsInvitation.updateMany({
        where: { staffId: id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await db.opsInvitation.create({
        data: {
          staffId: id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
      await db.opsSession.deleteMany({ where: { staffId: id } });
      await this.audit(db, viewer, "ops.invitation.renewed", id);
      return staff.user.email;
    });
    const invitationUrl = `${origin}/login?token=${token}`;
    const emailSent = await this.email.send(
      result,
      "Amsol Ops account access",
      `<p><a href="${invitationUrl}">Set your account password</a></p><p>This link expires in 7 days. The password is shared with your existing AIMS identity.</p>`,
    );
    return { invitationUrl, emailSent };
  }

  async setModuleAccess(viewer: Viewer, staffId: string, value: unknown, revision: number) {
    const dto = parse(
      z
        .object({
          module: z.enum(["water", "blog", "ledger"]),
          access: z.enum(["none", "view", "manage"]),
        })
        .strict(),
      value,
    );
    return this.mutate(viewer, revision, async (db) => {
      assertCeo(viewer);
      const staff = await db.opsStaff.findUnique({ where: { id: staffId } });
      if (!staff?.userId) throw new BadRequestException("Choose a staff account.");
      const where = { staffId_module: { staffId, module: dto.module } };
      const previous = await db.opsModuleGrant.findUnique({ where });
      if (dto.access === "none")
        await db.opsModuleGrant.deleteMany({ where: { staffId, module: dto.module } });
      else
        await db.opsModuleGrant.upsert({
          where,
          create: { staffId, module: dto.module, access: dto.access },
          update: { access: dto.access },
        });
      await this.audit(db, viewer, "ops.modules.access", staffId, previous, dto);
      return { success: true };
    });
  }

  async upload(
    viewer: Viewer,
    value: unknown,
    file: Express.Multer.File | undefined,
    revision: number,
  ) {
    if (!file || file.size === 0) throw new BadRequestException("Choose a non-empty file.");
    const record = parse(schemas.documents, value);
    if (
      record.weeklyRef &&
      (record.access !== "restricted" ||
        record.owner !== viewer.id ||
        record.project ||
        record.task ||
        record.dept ||
        record.allowed?.some((personId) => personId !== viewer.id) ||
        !record.weeklyRef.startsWith(`weekly:${viewer.id}:`))
    )
      throw new BadRequestException("Weekly attachments must be private to their author.");
    const key = `ops/documents/${record.id}/${randomUUID()}`;
    await this.storage.write(key, file.buffer);
    try {
      await this.mutate(viewer, revision, async (db, data) => {
        if (data.documents.some((doc) => doc.id === record.id))
          throw new ConflictException("Document already exists.");
        authorizeWrite(viewer, "documents", record, undefined, data);
        if (record.owner !== viewer.id)
          throw new BadRequestException("Uploads must belong to the signed-in staff member.");
        validateWorkspace({ ...data, documents: [...data.documents, record] });
        await db.opsDocument.create({
          data: {
            id: record.id,
            name: record.name,
            folder: record.folder,
            access: record.access,
            owner: viewer.id,
            updated: new Date().toISOString().slice(0, 10),
            project: record.project,
            task: record.task,
            weeklyRef: record.weeklyRef,
            dept: record.dept,
            storageKey: key,
            mime: file.mimetype || "application/octet-stream",
            size: file.size,
          },
        });
        if (record.access === "restricted" && record.allowed?.length)
          await db.opsDocumentGrant.createMany({
            data: record.allowed.map((personId) => ({ documentId: record.id, personId })),
          });
        await this.audit(db, viewer, "ops.documents.uploaded", record.id, undefined, {
          name: record.name,
          size: file.size,
        });
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => {});
      throw error;
    }
    return { id: record.id };
  }

  async document(viewer: Viewer, id: string) {
    const { workspace } = await this.workspace(viewer);
    const doc = workspace.documents.find((row) => row.id === id);
    if (!doc || !canReadDocument(viewer, doc, workspace))
      throw new NotFoundException("Document not found.");
    return this.prisma.opsDocument.findUniqueOrThrow({ where: { id } });
  }

  private async assertCurrentAccess(db: OpsTransaction, viewer: Viewer) {
    const [staff, session] = await Promise.all([
      db.opsStaff.findUnique({
        where: { id: viewer.id },
        include: { user: { select: { isActive: true } } },
      }),
      db.opsSession.findUnique({ where: { id: viewer.sessionId } }),
    ]);
    if (
      !staff?.active ||
      !staff.user?.isActive ||
      !session ||
      session.staffId !== viewer.id ||
      session.expiresAt <= new Date() ||
      session.idleExpiresAt <= new Date()
    )
      throw new UnauthorizedException("Your session has expired. Sign in again.");
    if (staff.role !== viewer.role || staff.dept !== viewer.dept)
      throw new ConflictException("Your permissions changed. Reload the workspace.");
  }

  private audit(
    db: OpsTransaction,
    viewer: Viewer,
    action: string,
    id: string,
    previous?: unknown,
    next?: unknown,
  ) {
    return db.auditLog.create({
      data: {
        userId: viewer.userId,
        action,
        entityType: "ops",
        entityId: id,
        oldValue: previous === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(previous)),
        newValue: next === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(next)),
      },
    });
  }
}
