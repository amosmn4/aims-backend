import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { StorageService } from "../../storage/storage.service";
import { assertDepartmentAccess } from "../../common/assert-department-access";
import type { AuthenticatedUser } from "../../auth/types/authenticated-user";
import type { CreateContractDto } from "./dto/create-contract.dto";
import type { UpdateContractDto } from "./dto/update-contract.dto";
import type { UploadDocumentDto } from "./dto/upload-document.dto";

const KEY_PREFIX = "contracts";

// Prisma's BigInt (sizeBytes) can't be JSON-serialized by Express as-is — file sizes are
// always well within Number.MAX_SAFE_INTEGER, so a plain Number is safe here.
function serializeDocument<T extends { sizeBytes: bigint }>(doc: T) {
  return { ...doc, sizeBytes: Number(doc.sizeBytes) };
}

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  findAll(filters: { departmentId?: string; clientId?: string }) {
    return this.prisma.contract.findMany({
      where: {
        ...(filters.departmentId && { departmentId: filters.departmentId }),
        ...(filters.clientId && { clientId: filters.clientId }),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string) {
    const contract = await this.prisma.contract.findUniqueOrThrow({
      where: { id },
      include: {
        client: true,
        department: true,
        serviceLine: true,
        documents: true,
        tender: { select: { id: true, referenceNumber: true, title: true } },
        clientRequest: { select: { id: true, referenceNumber: true, title: true } },
        projects: { select: { id: true, name: true } },
        _count: { select: { invoices: true } },
      },
    });
    return { ...contract, documents: contract.documents.map(serializeDocument) };
  }

  private async assertContractDeptAccess(departmentId: string | null, user: AuthenticatedUser) {
    if (!departmentId) {
      if (user.roles.includes("system_admin") || user.roles.includes("ceo")) return;
      throw new ForbiddenException("Only the CEO or System Administrator can manage this contract");
    }
    const department = await this.prisma.department.findUniqueOrThrow({
      where: { id: departmentId },
    });
    assertDepartmentAccess(department, user);
  }

  async create(dto: CreateContractDto, user: AuthenticatedUser) {
    await this.assertContractDeptAccess(dto.departmentId ?? null, user);
    return this.prisma.contract.create({
      data: {
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        nextInvoiceDate: dto.nextInvoiceDate ? new Date(dto.nextInvoiceDate) : undefined,
        createdBy: user.id,
      },
    });
  }

  async update(id: string, dto: UpdateContractDto, user: AuthenticatedUser) {
    const existing = await this.prisma.contract.findUniqueOrThrow({ where: { id } });
    await this.assertContractDeptAccess(existing.departmentId, user);

    return this.prisma.contract.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        nextInvoiceDate: dto.nextInvoiceDate ? new Date(dto.nextInvoiceDate) : undefined,
      },
    });
  }

  async remove(id: string, user: AuthenticatedUser) {
    const existing = await this.prisma.contract.findUniqueOrThrow({ where: { id } });
    await this.assertContractDeptAccess(existing.departmentId, user);
    return this.prisma.contract.delete({ where: { id } });
  }

  async listDocuments(contractId: string) {
    const docs = await this.prisma.contractDocument.findMany({
      where: { contractId },
      orderBy: { createdAt: "desc" },
    });
    return docs.map(serializeDocument);
  }

  async uploadDocument(
    contractId: string,
    file: Express.Multer.File,
    dto: UploadDocumentDto,
    userId: string,
  ) {
    const safeName = file.originalname.replace(/[^a-z0-9.\-_]+/gi, "_");
    const storedName = `${contractId}-${Date.now()}-${safeName}`;
    await this.storage.write(`${KEY_PREFIX}/${storedName}`, file.buffer);

    const doc = await this.prisma.contractDocument.create({
      data: {
        contractId,
        fileName: file.originalname,
        storagePath: storedName,
        mimeType: file.mimetype,
        sizeBytes: BigInt(file.size),
        category: dto.category ?? "other",
        uploadedBy: userId,
      },
    });
    return serializeDocument(doc);
  }

  async getDocumentFile(documentId: string) {
    const doc = await this.prisma.contractDocument.findUniqueOrThrow({ where: { id: documentId } });
    return { doc, key: `${KEY_PREFIX}/${doc.storagePath}` };
  }

  async deleteDocument(documentId: string) {
    const doc = await this.prisma.contractDocument.findUniqueOrThrow({ where: { id: documentId } });
    await this.storage.delete(`${KEY_PREFIX}/${doc.storagePath}`);
    const deleted = await this.prisma.contractDocument.delete({ where: { id: documentId } });
    return serializeDocument(deleted);
  }
}
