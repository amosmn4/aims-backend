import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  Document,
  DocumentAccessGrant,
  DocumentResourceType,
  DocumentVersion,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { assertDepartmentAccess } from "../common/assert-department-access";
import type { Paginated } from "../common/pagination";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { UploadDocumentDto } from "./dto/upload-document.dto";
import type { UpdateDocumentDto } from "./dto/update-document.dto";
import type { SetAccessGrantsDto } from "./dto/set-access-grants.dto";

// Documents live under the "documents/" key prefix in whatever StorageService resolves to
// (S3 when configured, local disk uploads/documents/ otherwise) — storagePath is a plain key,
// never a real filesystem path, so it works unchanged either way.
const KEY_PREFIX = "documents";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
]);

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

function isAdminOrCeo(user: AuthenticatedUser) {
  return user.roles.includes("system_admin") || user.roles.includes("ceo");
}

type SerializedVersion = Omit<DocumentVersion, "sizeBytes"> & { sizeBytes: number };

// Prisma's BigInt (sizeBytes) can't be JSON-serialized by Express as-is — file sizes are
// always well within Number.MAX_SAFE_INTEGER, so a plain Number is safe here.
function serializeVersion(v: DocumentVersion): SerializedVersion {
  return { ...v, sizeBytes: Number(v.sizeBytes) };
}

type DocumentWithRelations = Document & {
  latestVersion: DocumentVersion | null;
  accessGrants: DocumentAccessGrant[];
};

type SerializedDocument = Omit<Document, "resourceType"> & {
  resourceType: "contract" | DocumentResourceType;
  latestVersion: SerializedVersion | null;
  accessGrants: DocumentAccessGrant[];
};

function serializeDocument(doc: DocumentWithRelations): SerializedDocument {
  return {
    ...doc,
    latestVersion: doc.latestVersion ? serializeVersion(doc.latestVersion) : null,
  };
}

// A common shape both the generalized Document model and the legacy ContractDocument model
// map onto, so the central library can list both from one endpoint. See findAll().
type LibraryEntry = SerializedDocument;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Mirrors the access rule each resource's own controller/service already enforces —
   * one source of truth per resource type, re-checked live (not cached) on every attach.
   */
  private async assertCanAttach(
    resourceType: DocumentResourceType,
    resourceId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (resourceType === "project") {
      const project = await this.prisma.project.findUniqueOrThrow({
        where: { id: resourceId },
        include: { department: true },
      });
      assertDepartmentAccess(project.department, user);
      return;
    }

    if (resourceType === "task") {
      const task = await this.prisma.task.findUniqueOrThrow({
        where: { id: resourceId },
        include: { project: { include: { department: true } } },
      });
      if (task.assigneeId === user.id) return;
      assertDepartmentAccess(task.project.department, user);
      return;
    }

    if (resourceType === "tender") {
      const tender = await this.prisma.tender.findUniqueOrThrow({
        where: { id: resourceId },
        include: { department: true },
      });
      assertDepartmentAccess(tender.department, user);
      return;
    }

    if (resourceType === "client_request") {
      const request = await this.prisma.clientRequest.findUniqueOrThrow({
        where: { id: resourceId },
        include: { department: true },
      });
      // Unrouted requests have no department yet — they belong to Tender's intake.
      if (!request.department) {
        if (isAdminOrCeo(user) || user.roles.includes("tender")) return;
        throw new ForbiddenException("Only Tender can manage an unrouted request's documents");
      }
      assertDepartmentAccess(request.department, user);
      return;
    }

    // finance_report — Finance Reports have no per-record department; access is uniformly
    // role-gated, matching FinanceReportsController's class-level @Roles("finance").
    if (!user.roles.includes("finance") && !isAdminOrCeo(user)) {
      throw new ForbiddenException("Only Finance staff can manage finance report documents");
    }
  }

  /** Zero grants = visible to everyone; otherwise a match on the grant set is required. */
  private canView(
    doc: { createdBy: string | null; accessGrants: DocumentAccessGrant[] },
    user: AuthenticatedUser,
  ) {
    if (isAdminOrCeo(user)) return true;
    if (doc.createdBy === user.id) return true;
    if (doc.accessGrants.length === 0) return true;
    return doc.accessGrants.some((g) => {
      if (g.accessType === "everyone") return true;
      if (g.accessType === "department")
        return !!user.departmentId && g.departmentId === user.departmentId;
      if (g.accessType === "user") return g.userId === user.id;
      return false;
    });
  }

  async findAll(
    filters: {
      resourceType?: string;
      resourceId?: string;
      departmentId?: string;
      tag?: string;
      q?: string;
      mine?: boolean;
      // True when someone specifically shared this document with the viewer (a `user`-type
      // access grant naming them) rather than it just being visible to them by default —
      // the Google-Drive-style "Shared with me" view, distinct from "Mine" (uploaded by them)
      // and from the department-scoped default list.
      sharedWithMe?: boolean;
      page?: number;
      pageSize?: number;
    },
    user: AuthenticatedUser,
  ): Promise<LibraryEntry[] | Paginated<LibraryEntry>> {
    const documents = await this.prisma.document.findMany({
      where: {
        ...(filters.resourceType &&
          filters.resourceType !== "contract" && {
            resourceType: filters.resourceType as DocumentResourceType,
          }),
        ...(filters.resourceId && { resourceId: filters.resourceId }),
        ...(filters.mine && { createdBy: user.id }),
        ...(filters.q && {
          OR: [
            { title: { contains: filters.q } },
            { latestVersion: { fileName: { contains: filters.q } } },
          ],
        }),
      },
      include: { latestVersion: true, accessGrants: true },
      orderBy: { createdAt: "desc" },
    });

    let entries: LibraryEntry[] = documents
      .filter((doc) => this.canView(doc, user))
      .map((doc) => ({ ...serializeDocument(doc), resourceType: doc.resourceType }))
      .filter(
        (doc) =>
          !filters.tag ||
          (Array.isArray(doc.tags) && (doc.tags as string[]).includes(filters.tag!)),
      );

    if (filters.sharedWithMe) {
      entries = entries.filter(
        (doc) =>
          doc.createdBy !== user.id &&
          doc.accessGrants.some((g) => g.accessType === "user" && g.userId === user.id),
      );
    }

    // Department filter only applies to resource types that actually carry a department;
    // project/task documents are filtered via their parent's department in application code
    // since Document has no direct department column.
    if (filters.departmentId) {
      const [projectIds, taskProjectIds] = await Promise.all([
        this.prisma.project.findMany({
          where: { departmentId: filters.departmentId },
          select: { id: true },
        }),
        this.prisma.task.findMany({
          where: { project: { departmentId: filters.departmentId } },
          select: { id: true },
        }),
      ]);
      const allowedIds = new Set([
        ...projectIds.map((p) => p.id),
        ...taskProjectIds.map((t) => t.id),
      ]);
      entries = entries.filter((doc) =>
        doc.resourceType !== "project" && doc.resourceType !== "task"
          ? true
          : allowedIds.has(doc.resourceId),
      );
    }

    // Contracts documents live in the legacy ContractDocument table — merge them in so the
    // central library shows everything, unless the caller explicitly scoped to a non-contract
    // resourceType or a specific resourceId (contracts have no resourceId query support here).
    const includeContracts =
      !filters.resourceId && (!filters.resourceType || filters.resourceType === "contract");
    if (includeContracts && !filters.tag) {
      const contractDocs = await this.prisma.contractDocument.findMany({
        where: {
          ...(filters.mine && { uploadedBy: user.id }),
          ...(filters.q && { fileName: { contains: filters.q } }),
          ...(filters.departmentId && { contract: { departmentId: filters.departmentId } }),
        },
        orderBy: { createdAt: "desc" },
      });
      const mapped: LibraryEntry[] = contractDocs.map((cd) => ({
        id: cd.id,
        resourceType: "contract",
        resourceId: cd.contractId,
        title: cd.fileName,
        description: null,
        category: cd.category,
        tags: null,
        latestVersionId: null,
        createdBy: cd.uploadedBy,
        createdAt: cd.createdAt,
        updatedAt: cd.createdAt,
        accessGrants: [],
        latestVersion: {
          id: cd.id,
          documentId: cd.id,
          versionNo: cd.version,
          fileName: cd.fileName,
          storagePath: cd.storagePath,
          mimeType: cd.mimeType,
          sizeBytes: Number(cd.sizeBytes),
          uploadedBy: cd.uploadedBy,
          createdAt: cd.createdAt,
        },
      }));
      entries = [...entries, ...mapped].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
    }

    // Filtering/merging above happens in application code (visibility check, tag filter, legacy
    // ContractDocument merge), so — unlike the plain-Prisma-model list endpoints — pagination has
    // to slice the final assembled array rather than push skip/take into the query itself.
    if (!filters.page && !filters.pageSize) return entries;
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize =
      filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 25;
    const start = (page - 1) * pageSize;
    return { data: entries.slice(start, start + pageSize), total: entries.length, page, pageSize };
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const doc = await this.prisma.document.findUniqueOrThrow({
      where: { id },
      include: { latestVersion: true, accessGrants: true },
    });
    if (!this.canView(doc, user)) {
      throw new ForbiddenException("You do not have access to this document");
    }
    return serializeDocument(doc);
  }

  private validateFile(file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file was uploaded");
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException("File exceeds the 25MB upload limit");
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`File type "${file.mimetype}" is not allowed`);
    }
  }

  private async writeVersionFile(
    resourceType: DocumentResourceType,
    resourceId: string,
    documentId: string,
    versionNo: number,
    file: Express.Multer.File,
  ) {
    const safeName = file.originalname.replace(/[^a-z0-9.\-_]+/gi, "_");
    const storedName = `v${versionNo}-${Date.now()}-${safeName}`;
    const storagePath = `${resourceType}/${resourceId}/${documentId}/${storedName}`;
    await this.storage.write(`${KEY_PREFIX}/${storagePath}`, file.buffer);
    return storagePath;
  }

  async upload(file: Express.Multer.File, dto: UploadDocumentDto, user: AuthenticatedUser) {
    this.validateFile(file);
    await this.assertCanAttach(dto.resourceType, dto.resourceId, user);

    const doc = await this.prisma.document.create({
      data: {
        resourceType: dto.resourceType,
        resourceId: dto.resourceId,
        title: dto.title ?? file.originalname,
        description: dto.description,
        category: dto.category ?? "other",
        tags: dto.tags
          ? dto.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
        createdBy: user.id,
      },
    });

    const storagePath = await this.writeVersionFile(
      dto.resourceType,
      dto.resourceId,
      doc.id,
      1,
      file,
    );
    const version = await this.prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNo: 1,
        fileName: file.originalname,
        storagePath,
        mimeType: file.mimetype,
        sizeBytes: BigInt(file.size),
        uploadedBy: user.id,
      },
    });

    const updated = await this.prisma.document.update({
      where: { id: doc.id },
      data: { latestVersionId: version.id },
      include: { latestVersion: true, accessGrants: true },
    });
    return serializeDocument(updated);
  }

  async addVersion(documentId: string, file: Express.Multer.File, user: AuthenticatedUser) {
    this.validateFile(file);
    const doc = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    await this.assertCanAttach(doc.resourceType, doc.resourceId, user);

    const versionNo =
      ((
        await this.prisma.documentVersion.aggregate({
          where: { documentId },
          _max: { versionNo: true },
        })
      )._max.versionNo ?? 0) + 1;

    const storagePath = await this.writeVersionFile(
      doc.resourceType,
      doc.resourceId,
      doc.id,
      versionNo,
      file,
    );
    const version = await this.prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNo,
        fileName: file.originalname,
        storagePath,
        mimeType: file.mimetype,
        sizeBytes: BigInt(file.size),
        uploadedBy: user.id,
      },
    });

    const updated = await this.prisma.document.update({
      where: { id: doc.id },
      data: { latestVersionId: version.id, updatedAt: new Date() },
      include: { latestVersion: true, accessGrants: true },
    });
    return serializeDocument(updated);
  }

  async listVersions(documentId: string, user: AuthenticatedUser) {
    const doc = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { accessGrants: true },
    });
    if (!this.canView(doc, user)) {
      throw new ForbiddenException("You do not have access to this document");
    }
    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { versionNo: "desc" },
    });
    return versions.map(serializeVersion);
  }

  async getFileForDownload(
    documentId: string,
    versionId: string | undefined,
    user: AuthenticatedUser,
  ) {
    const doc = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { accessGrants: true },
    });
    if (!this.canView(doc, user)) {
      throw new ForbiddenException("You do not have access to this document");
    }

    const version = versionId
      ? await this.prisma.documentVersion.findUniqueOrThrow({ where: { id: versionId } })
      : await this.prisma.documentVersion.findUniqueOrThrow({
          where: { id: doc.latestVersionId! },
        });

    return { fileName: version.fileName, key: `${KEY_PREFIX}/${version.storagePath}` };
  }

  async update(documentId: string, dto: UpdateDocumentDto, user: AuthenticatedUser) {
    const doc = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    await this.assertCanAttach(doc.resourceType, doc.resourceId, user);

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        title: dto.title,
        description: dto.description,
        category: dto.category,
        tags: dto.tags,
      },
      include: { latestVersion: true, accessGrants: true },
    });
    return serializeDocument(updated);
  }

  async remove(documentId: string, user: AuthenticatedUser) {
    const doc = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    await this.assertCanAttach(doc.resourceType, doc.resourceId, user);

    const versions = await this.prisma.documentVersion.findMany({ where: { documentId } });
    await Promise.all(versions.map((v) => this.storage.delete(`${KEY_PREFIX}/${v.storagePath}`)));
    // latestVersionId points at a DocumentVersion row, so it must be cleared before the
    // version rows (and then the document itself) can be deleted.
    await this.prisma.document.update({
      where: { id: documentId },
      data: { latestVersionId: null },
    });
    return this.prisma.document.delete({ where: { id: documentId } });
  }

  /** Called by Projects/Tasks/FinanceReports services before deleting the parent resource,
   * since there is no DB-level FK from Document to those tables (resourceId is polymorphic). */
  async deleteAllForResource(resourceType: DocumentResourceType, resourceId: string) {
    const docs = await this.prisma.document.findMany({
      where: { resourceType, resourceId },
      select: { id: true },
    });
    if (docs.length === 0) return;
    const docIds = docs.map((d) => d.id);

    // Batched instead of one findMany/update/delete per document — a project with dozens of
    // attached documents used to mean dozens of sequential round trips here. DocumentVersion
    // rows cascade-delete with their Document at the DB level (see the schema's onDelete:
    // Cascade), so the only reason to fetch versions up front is to know their storage paths
    // before the rows disappear.
    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId: { in: docIds } },
      select: { storagePath: true },
    });
    await Promise.all(versions.map((v) => this.storage.delete(`${KEY_PREFIX}/${v.storagePath}`)));
    // latestVersionId points at a DocumentVersion row, so it must be cleared before the
    // version rows (and then the documents themselves) can be deleted.
    await this.prisma.document.updateMany({
      where: { id: { in: docIds } },
      data: { latestVersionId: null },
    });
    await this.prisma.document.deleteMany({ where: { id: { in: docIds } } });
  }

  async getAccess(documentId: string, user: AuthenticatedUser) {
    const doc = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    await this.assertCanAttach(doc.resourceType, doc.resourceId, user);
    return this.prisma.documentAccessGrant.findMany({ where: { documentId } });
  }

  async setAccess(documentId: string, dto: SetAccessGrantsDto, user: AuthenticatedUser) {
    const doc = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    await this.assertCanAttach(doc.resourceType, doc.resourceId, user);

    // De-duplicate — MySQL unique indexes don't dedupe NULLs, so this has to happen here
    // rather than at the DB level. "Everyone" collapses to a single grant.
    const seen = new Set<string>();
    const grants = dto.grants.filter((g) => {
      const key = `${g.accessType}:${g.departmentId ?? ""}:${g.userId ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    await this.prisma.$transaction([
      this.prisma.documentAccessGrant.deleteMany({ where: { documentId } }),
      ...(grants.length > 0
        ? [
            this.prisma.documentAccessGrant.createMany({
              data: grants.map((g) => ({
                documentId,
                accessType: g.accessType,
                departmentId: g.accessType === "department" ? g.departmentId : undefined,
                userId: g.accessType === "user" ? g.userId : undefined,
              })),
            }),
          ]
        : []),
    ]);

    return this.prisma.documentAccessGrant.findMany({ where: { documentId } });
  }
}
