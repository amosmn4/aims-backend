import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { Prisma, type WaterImportRow } from "@prisma/client";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { WaterFileExtractionService, MAX_IMPORT_BYTES } from "./water-file-extraction.service";
import {
  importDate,
  importRecordSchema,
  volumeFactor,
  type ImportRecord,
} from "./water-import.types";
import {
  WaterReadingReviewService,
  type ReadingReview,
  type WaterDatabase,
} from "./water-reading-review.service";
import type { ReadingObservation, ReadingWarning } from "./reading-assessment";
import type { CreateReadingDto } from "./dto/create-reading.dto";
import type { ConfirmWaterImportDto } from "./dto/water-import.dto";
import { WaterImportSuggestionsService } from "./water-import-suggestions.service";
import { WaterUploadRemovalService, type WaterEntityType } from "./water-upload-removal.service";
import { normaliseMatch, type RecordSuggestion } from "./record-suggestions";

type RowContext = { rows: WaterImportRow[]; groups: Map<string, WaterImportRow[]> };
export interface ImportReview {
  suggestions: RecordSuggestion[];
  status: "ready" | "warning" | "blocked" | "duplicate" | "ignored";
  issues: string[];
  warnings: ReadingWarning[];
  reviewToken: string;
  meterId?: string;
  meterLabel?: string;
  targetId?: string;
  reading?: ReadingReview;
  dto?: CreateReadingDto;
  zoneId?: string | null;
  customerId?: string;
}
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const numberEqual = (left: unknown, right: unknown) =>
  (left == null && right == null) ||
  (left != null && right != null && Number(left) === Number(right));

@Injectable()
export class WaterImportService {
  private readonly logger = new Logger(WaterImportService.name);
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly extraction: WaterFileExtractionService,
    private readonly readings: WaterReadingReviewService,
    private readonly config: ConfigService,
    private readonly suggestions: WaterImportSuggestionsService,
    private readonly removal: WaterUploadRemovalService,
  ) {}

  async upload(file: Express.Multer.File | undefined, user: AuthenticatedUser) {
    if (!file || !file.buffer.length)
      throw new BadRequestException("Choose a file containing water records.");
    if (file.size > MAX_IMPORT_BYTES)
      throw new BadRequestException("The upload limit is 25 MB. Split larger files first.");
    const fileName = file.originalname.replace(/^.*[\\/]/, "").trim();
    if (!fileName || fileName.length > 191)
      throw new BadRequestException("Use a file name of at most 191 characters.");
    const extension = fileName.split(".").at(-1)?.toLowerCase() || "";
    const types: Record<string, string> = {
      csv: "text/csv",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
    };
    if (!types[extension])
      throw new BadRequestException("Supported files: PNG, JPEG, WebP, PDF, Word, CSV, and Excel.");
    const signature = file.buffer.subarray(0, 12);
    const zip = signature.subarray(0, 2).toString() === "PK";
    const compound = signature.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1";
    const valid =
      extension === "pdf"
        ? signature.subarray(0, 5).toString() === "%PDF-"
        : extension === "png"
          ? signature.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
          : ["jpg", "jpeg"].includes(extension)
            ? signature[0] === 255 && signature[1] === 216
            : extension === "webp"
              ? signature.subarray(0, 4).toString() === "RIFF" &&
                signature.subarray(8, 12).toString() === "WEBP"
              : ["xlsx", "docx"].includes(extension)
                ? zip
                : ["xls", "doc"].includes(extension)
                  ? compound
                  : !zip && !compound && !file.buffer.subarray(0, 1024).includes(0);
    if (!valid)
      throw new BadRequestException(
        "The file content does not match its extension. Export it again using a supported format.",
      );
    const id = randomUUID();
    const storageKey = `water-imports/${id}.${extension}`;
    await this.storage.write(storageKey, file.buffer);
    try {
      const batch = await this.prisma.waterImportBatch.create({
        data: {
          id,
          fileName,
          mimeType: types[extension],
          storageKey,
          fileHash: createHash("sha256").update(file.buffer).digest("hex"),
          uploadedBy: user.id,
        },
      });
      return this.presentBatch(batch);
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async list() {
    return (
      await this.prisma.waterImportBatch.findMany({ orderBy: { createdAt: "desc" }, take: 50 })
    ).map((batch) => this.presentBatch(batch));
  }

  async get(id: string, user: AuthenticatedUser, page = 1, status?: string) {
    const batch = await this.batch(id);
    const where = { batchId: id, ...(status && { status }) };
    const [rows, total, counts] = await Promise.all([
      this.prisma.waterImportRow.findMany({
        where,
        orderBy: { position: "asc" },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.waterImportRow.count({ where }),
      this.prisma.waterImportRow.groupBy({
        by: ["status"],
        where: { batchId: id },
        _count: { _all: true },
      }),
    ]);
    const context = batch.status === "review" ? await this.context(id) : undefined;
    const reviewed = [];
    for (const row of rows)
      reviewed.push({
        ...row,
        ...(context &&
          row.status === "pending" && { assessment: await this.review(row, user.id, context) }),
      });
    return {
      ...this.presentBatch(batch),
      previewToken: ["review", "completed"].includes(batch.status)
        ? this.previewToken(batch, user.id)
        : null,
      rows: reviewed,
      total,
      page,
      pageSize: 50,
      counts: Object.fromEntries(counts.map((count) => [count.status, count._count._all])),
    };
  }

  async source(id: string) {
    return this.batch(id);
  }

  async updateRow(batchId: string, rowId: string, data: Record<string, unknown>) {
    const parsed = importRecordSchema.safeParse(data);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM water_import_batches WHERE id = ${batchId} FOR UPDATE`,
      );
      const batch = await this.batch(batchId, tx);
      if (batch.status !== "review")
        throw new ConflictException("Only imports awaiting review can be edited.");
      const row = await tx.waterImportRow.findFirst({ where: { id: rowId, batchId } });
      if (!row) throw new NotFoundException("Import row not found.");
      if (row.status !== "pending")
        throw new ConflictException("This row has already been processed.");
      await tx.waterImportBatch.update({
        where: { id: batchId },
        data: { previewVersion: { increment: 1 } },
      });
      return tx.waterImportRow.update({
        where: { id: rowId },
        data: { data: json(parsed.data), issues: [], warnings: [] },
      });
    });
  }

  async retry(id: string) {
    const result = await this.prisma.waterImportBatch.updateMany({
      where: { id, status: "failed" },
      data: { status: "queued", error: null, leaseUntil: null },
    });
    if (!result.count) throw new ConflictException("Only failed extraction jobs can be retried.");
    return this.presentBatch(await this.batch(id));
  }

  async beginRecording(id: string, user: AuthenticatedUser, previewToken?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM water_import_batches WHERE id = ${id} FOR UPDATE`,
      );
      const batch = await this.batch(id, tx);
      this.requirePreview(batch, user.id, previewToken);
      if (batch.status !== "review")
        throw new ConflictException("Only an import awaiting review can be confirmed.");
      const updated = await tx.waterImportBatch.update({
        where: { id },
        data: {
          status: "recording",
          error: null,
          leaseUntil: null,
          processedParts: 0,
          totalParts: batch.totalRows * 2,
          summary: { autoImportUserId: user.id, sourceParts: batch.totalParts },
        },
      });
      return this.presentBatch(updated);
    });
  }

  @Interval(5000)
  async processNext() {
    if (this.processing) return;
    this.processing = true;
    let batchId: string | undefined;
    let recording = false;
    try {
      const available = {
        OR: [
          { status: "queued" },
          { status: "processing", leaseUntil: { lt: new Date() } },
          { status: "recording", OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
        ],
      };
      const batch = await this.prisma.waterImportBatch.findFirst({
        where: available,
        orderBy: { createdAt: "asc" },
      });
      if (!batch) return;
      const claim = await this.prisma.waterImportBatch.updateMany({
        where: { id: batch.id, ...available },
        data: {
          status: batch.status === "recording" ? "recording" : "processing",
          leaseUntil: new Date(Date.now() + 600000),
          error: null,
        },
      });
      if (!claim.count) return;
      batchId = batch.id;
      recording = batch.status === "recording";
      if (recording) {
        await this.recordReady(batch);
        return;
      }
      const buffer = await this.storage.read(batch.storageKey);
      const rows = await this.extraction.extract(buffer, batch.fileName, async (done, total) => {
        await this.prisma.waterImportBatch.update({
          where: { id: batch.id },
          data: {
            processedParts: done,
            totalParts: total,
            leaseUntil: new Date(Date.now() + 600000),
          },
        });
      });
      if (!rows.length)
        throw new Error(
          "No water records could be extracted. Check the source file, its headings, and image clarity.",
        );
      await this.prisma.$transaction(
        async (tx) => {
          await tx.waterImportRow.deleteMany({ where: { batchId: batch.id } });
          for (let offset = 0; offset < rows.length; offset += 500)
            await tx.waterImportRow.createMany({
              data: rows.slice(offset, offset + 500).map((row, index) => ({
                batchId: batch.id,
                position: offset + index + 1,
                source: row.source.slice(0, 191),
                raw: json(row.raw),
                data: json(row.data),
                issues: row.extractionIssues ?? [],
              })),
            });
          await tx.waterImportBatch.update({
            where: { id: batch.id },
            data: {
              status: "review",
              totalRows: rows.length,
              previewVersion: { increment: 1 },
              leaseUntil: null,
              summary: {
                extracted: rows.length,
                instructions:
                  "Review each destination. Confirmed warnings are retained with the imported records.",
              },
            },
          });
        },
        { timeout: 60000 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "File extraction failed.";
      if (batchId)
        await this.prisma.waterImportBatch
          .update({
            where: { id: batchId },
            data: {
              status: recording ? "review" : "failed",
              error: message.slice(0, 2000),
              leaseUntil: null,
            },
          })
          .catch(() => undefined);
      this.logger.warn(`Water import: ${message.slice(0, 300)}`);
    } finally {
      this.processing = false;
    }
  }

  async confirm(
    batchId: string,
    request: ConfirmWaterImportDto,
    user: AuthenticatedUser,
    backgroundContext?: RowContext,
  ) {
    if (new Set(request.rows.map((row) => row.id)).size !== request.rows.length)
      throw new BadRequestException("Select each import row only once.");
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM water_import_batches WHERE id = ${batchId} FOR UPDATE`,
        );
        const batch = await this.batch(batchId, tx);
        if (!backgroundContext) this.requirePreview(batch, user.id, request.previewToken);
        if (
          !(backgroundContext
            ? batch.status === "recording"
            : ["review", "completed"].includes(batch.status))
        )
          throw new ConflictException("Wait until extraction finishes before confirming records.");
        const context = backgroundContext ?? (await this.context(batchId, tx));
        const requested = request.rows.map((input) => {
          const row = context.rows.find((row) => row.id === input.id);
          if (!row) throw new BadRequestException("A selected row does not belong to this import.");
          return { row, input };
        });
        const meterNumbers = [
          ...new Set(
            requested
              .map(({ row }) => (row.data as unknown as ImportRecord).meterNumber)
              .filter((number): number is string => !!number),
          ),
        ].sort();
        for (const meterNumber of meterNumbers)
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM water_meters WHERE meter_number = ${meterNumber} FOR UPDATE`,
          );
        const checked = [];
        for (const selected of requested) {
          if (selected.row.status !== "pending") continue;
          const assessment = await this.review(selected.row, user.id, context, tx);
          if (assessment.status === "blocked")
            throw new ConflictException({
              message: `Resolve ${selected.row.source} before importing it.`,
              issues: assessment.issues,
            });
          if (selected.input.reviewToken !== assessment.reviewToken)
            throw new ConflictException(
              "The data or meter history changed. Refresh the preview and review the affected rows again.",
            );
          if (assessment.warnings.length && (selected.input.reviewReason?.trim().length ?? 0) < 5)
            throw new ConflictException("Enter a reason confirming each row with warnings.");
          checked.push({ ...selected, assessment });
        }
        for (const { row, input, assessment } of checked) {
          const data = importRecordSchema.parse(row.data);
          const targetType = data.kind;
          let targetId = assessment.targetId;
          let status: string = assessment.status;
          if (!["duplicate", "ignored"].includes(assessment.status)) {
            const result = await this.write(
              data,
              assessment,
              user,
              input.reviewReason,
              tx,
              batchId,
            );
            targetId = result.id;
            status = "imported";
          }
          await tx.waterImportRow.update({
            where: { id: row.id },
            data: {
              status,
              targetType,
              targetId,
              warnings: json(assessment.warnings),
              confirmedBy: user.id,
              confirmedAt: new Date(),
              ...(input.reviewReason && {
                issues: json([{ confirmationReason: input.reviewReason.trim() }]),
              }),
            },
          });
          await tx.auditLog.create({
            data: {
              userId: user.id,
              action: "create",
              entityType: "water_import",
              entityId: row.id,
              metadata: json({
                batchId,
                source: row.source,
                targetType,
                targetId,
                status,
                warnings: assessment.warnings,
                confirmationReason: input.reviewReason || null,
              }),
            },
          });
        }
        const pending = await tx.waterImportRow.count({ where: { batchId, status: "pending" } });
        const counts = await tx.waterImportRow.groupBy({
          by: ["status"],
          where: { batchId },
          _count: { _all: true },
        });
        const summary = Object.fromEntries(
          counts.map((count) => [count.status, count._count._all]),
        );
        await tx.waterImportBatch.update({
          where: { id: batchId },
          data: {
            status: backgroundContext ? "recording" : pending ? "review" : "completed",
            summary: backgroundContext
              ? { ...this.summaryState(batch.summary), counts: summary }
              : summary,
          },
        });
        return {
          processed: checked.length,
          pending,
          counts: summary,
          processedIds: checked.map(({ row }) => row.id),
        };
      },
      { timeout: 60000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private async recordReady(batch: Awaited<ReturnType<WaterImportService["batch"]>>) {
    const state = this.summaryState(batch.summary);
    const actorId = state.autoImportUserId;
    if (typeof actorId !== "string")
      throw new Error("This bulk confirmation has no recorded actor. Review the import again.");
    const user: AuthenticatedUser = {
      id: actorId,
      email: "",
      roles: ["water"],
      departmentId: null,
    };
    const context = await this.context(batch.id);
    let checked = 0;
    for (let pass = 0; pass < 2; pass++) {
      let processed = 0;
      const candidates = context.rows.filter((row) => row.status === "pending");
      for (let offset = 0; offset < candidates.length; offset += 50) {
        const chunk = candidates.slice(offset, offset + 50);
        for (let attempt = 0; attempt < 2; attempt++) {
          const selections = [];
          for (const row of chunk) {
            const assessment = await this.review(row, user.id, context);
            if (assessment.status !== "blocked" && !assessment.warnings.length)
              selections.push({ id: row.id, reviewToken: assessment.reviewToken });
          }
          if (!selections.length) break;
          try {
            const result = await this.confirm(
              batch.id,
              { rows: selections, previewToken: "background" },
              user,
              context,
            );
            const saved = new Set(result.processedIds);
            for (const row of chunk) if (saved.has(row.id)) row.status = "imported";
            processed += result.processed;
            break;
          } catch (error) {
            if (!(error instanceof ConflictException) || attempt === 1) throw error;
          }
        }
        checked += chunk.length;
        await this.prisma.waterImportBatch.update({
          where: { id: batch.id },
          data: { processedParts: checked, leaseUntil: new Date(Date.now() + 600000) },
        });
      }
      if (!processed) break;
    }
    const pending = await this.prisma.waterImportRow.count({
      where: { batchId: batch.id, status: "pending" },
    });
    const counts = await this.prisma.waterImportRow.groupBy({
      by: ["status"],
      where: { batchId: batch.id },
      _count: { _all: true },
    });
    await this.prisma.waterImportBatch.update({
      where: { id: batch.id },
      data: {
        status: pending ? "review" : "completed",
        leaseUntil: null,
        error: null,
        summary: {
          ...state,
          counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
          needsReview: pending,
        },
      },
    });
  }

  private summaryState(value: Prisma.JsonValue | null): Prisma.JsonObject {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  private async review(
    row: WaterImportRow,
    userId: string,
    context: RowContext,
    db: WaterDatabase = this.prisma,
  ): Promise<ImportReview> {
    const data = importRecordSchema.parse(row.data);
    const result: ImportReview = {
      suggestions: [],
      status: "ready",
      issues: Array.isArray(row.issues)
        ? row.issues.filter((issue): issue is string => typeof issue === "string")
        : [],
      warnings: [],
      reviewToken: "",
    };
    if (data.kind === "ignored") {
      if ((data.notes?.trim().length ?? 0) < 5)
        result.issues.push("Give a reason for excluding this source row.");
      result.status = "ignored";
    } else if (data.kind === "unresolved")
      result.issues.push("Choose the correct record type and complete the extracted fields.");
    if (["reading", "purchase", "usage", "meter"].includes(data.kind) && !data.meterNumber?.trim())
      result.issues.push("Specify the exact meter number, preserving leading zeros.");
    const meter = data.meterNumber
      ? await db.waterMeter.findUnique({
          where: { meterNumber: data.meterNumber.trim() },
          include: { customer: true },
        })
      : null;
    if (meter) {
      result.meterId = meter.id;
      result.meterLabel = `${meter.meterNumber} · ${meter.meterType}${meter.name ? ` · ${meter.name}` : ""}${meter.customer?.name ? ` · ${meter.customer.name}` : ""}`;
      if (data.meterType && data.meterType !== meter.meterType)
        result.issues.push(
          `The registered meter type is ${meter.meterType}, while the file says ${data.meterType}.`,
        );
      if (!meter.isActive && data.kind !== "ignored")
        result.issues.push(
          "This meter is inactive. Resolve its status before importing new records.",
        );
    } else if (["reading", "purchase", "usage"].includes(data.kind))
      result.issues.push(
        "Unknown meter. Register it with its correct type first; meters are not created automatically from readings or payments.",
      );
    if (!meter && ["reading", "purchase", "usage", "meter", "customer"].includes(data.kind))
      result.suggestions = await this.suggestions.suggest(data);
    if (
      ["reading", "usage"].includes(data.kind) &&
      meter?.customer &&
      data.customerName &&
      normaliseMatch(data.customerName) !== normaliseMatch(meter.customer.name)
    ) {
      result.warnings.push({
        code: "customer_name_mismatch",
        severity: "danger",
        message: `The source names ${data.customerName}, but meter ${meter.meterNumber} belongs to ${meter.customer.name}. Verify the intended account before recording.`,
      });
      result.suggestions.push(
        {
          label: `Use registered name: ${meter.customer.name}`,
          explanation:
            "Use this only if the meter number is correct and the source name is a typo.",
          confidence: "possible",
          recordId: meter.id,
          patch: { customerName: meter.customer.name },
        },
        ...(await this.suggestions.suggest(data)),
      );
    }
    const factor = volumeFactor(data.volumeUnit);
    if (factor === null && ["reading", "usage", "purchase"].includes(data.kind))
      result.issues.push("Specify a supported volume unit: m3 or litres.");
    if (factor === 0.001)
      result.warnings.push({
        code: "litres_converted",
        severity: "warning",
        message:
          "The source is in litres. Volumes will be divided by 1,000 and saved as cubic metres.",
      });
    const at = importDate(data.date);
    if (["reading", "purchase"].includes(data.kind) && !at)
      result.issues.push(
        "Supply an unambiguous date as YYYY-MM-DD, optionally including time. Unzoned times use Nairobi time.",
      );
    try {
      if (data.kind === "reading" && meter && at && factor !== null) {
        if (meter.meterType === "household" && data.dialReading !== null) {
          result.issues.push(
            "For a household meter, classify the number as remainingBalance or cumulativeUsage. A generic dial reading is ambiguous.",
          );
          for (const field of ["remainingBalance", "cumulativeUsage"] as const)
            if (data[field] === null)
              result.suggestions.push({
                label: `Classify ${data.dialReading} as ${field === "remainingBalance" ? "remaining prepaid credit" : "lifetime usage counter"}`,
                explanation:
                  "These figures mean different things. Check the source heading or meter display before choosing.",
                confidence: "possible",
                patch: { dialReading: null, [field]: data.dialReading },
              });
        }
        if (meter.meterType !== "household" && data.remainingBalance !== null)
          result.issues.push("Remaining prepaid balance belongs to household meters.");
        const dto: CreateReadingDto = {
          meterId: meter.id,
          readingDate: at.toISOString(),
          value:
            (meter.meterType === "household" ? data.remainingBalance : data.dialReading) === null
              ? null
              : (meter.meterType === "household" ? data.remainingBalance! : data.dialReading!) *
                factor,
          cumulativeUsage: data.cumulativeUsage === null ? null : data.cumulativeUsage * factor,
          notes: data.notes?.slice(0, 191),
        };
        result.dto = dto;
        const existing = await db.waterMeterReading.findFirst({
          where: { meterId: meter.id, readingDate: at },
        });
        if (existing) {
          if (
            numberEqual(existing.value, dto.value) &&
            numberEqual(existing.cumulativeUsage, dto.cumulativeUsage)
          ) {
            result.status = "duplicate";
            result.targetId = existing.id;
          } else
            result.issues.push(
              "A different reading already exists at this time. Edit that reading explicitly instead of overwriting it through an import.",
            );
        } else {
          const group = context.groups.get(data.meterNumber!.trim().toLowerCase()) ?? [];
          const conflicts = group.filter(
            (other) =>
              other.id !== row.id &&
              other.status === "pending" &&
              (other.data as unknown as ImportRecord).kind === "reading" &&
              +(importDate((other.data as unknown as ImportRecord).date) ?? 0) === +at,
          );
          if (
            conflicts.some((other) => {
              const candidate = other.data as unknown as ImportRecord;
              return (
                candidate.dialReading !== data.dialReading ||
                candidate.remainingBalance !== data.remainingBalance ||
                candidate.cumulativeUsage !== data.cumulativeUsage
              );
            })
          )
            result.issues.push(
              "This file contains conflicting readings for the same meter and time. Resolve both rows.",
            );
          else if (conflicts.some((other) => other.position < row.position))
            result.issues.push(
              "An identical earlier row is awaiting confirmation. Import that row first; this one will then be identified as a duplicate.",
            );
          const staged = this.stagedReadings(group, meter.meterType, row.id);
          result.reading = await this.readings.assess(dto, userId, db, undefined, staged);
          result.suggestions.push(
            ...result.reading.suggestions.map((suggestion) => ({
              ...suggestion,
              patch: Object.fromEntries(
                Object.entries(suggestion.patch).map(([key, value]) => [
                  key,
                  typeof value === "number" ? value / factor : value,
                ]),
              ),
            })),
          );
          result.warnings.push(...result.reading.warnings);
        }
      }
      if (data.kind === "purchase" && meter && at && factor !== null) {
        if (meter.meterType !== "household")
          result.issues.push(
            "Purchases belong to household meters. A bulk consumption figure must be imported as a reading or period usage.",
          );
        if (data.units === null || data.amountPaid === null)
          result.issues.push(
            "Purchases need both units purchased and the amount paid. Missing values are not recorded as zero.",
          );
        else {
          this.assertDecimal(data.units * factor, 9999999999.99);
          this.assertDecimal(data.amountPaid, 999999999999.99);
          const existing = await db.waterUsageRecord.findFirst({
            where: {
              meterId: meter.id,
              recordedAt: at,
              unitsSold: data.units * factor,
              amountPaid: data.amountPaid,
            },
          });
          if (existing) {
            result.status = "duplicate";
            result.targetId = existing.id;
          }
          const pendingDuplicate = (
            context.groups.get(data.meterNumber!.trim().toLowerCase()) ?? []
          ).some((other) => {
            const candidate = other.data as unknown as ImportRecord;
            return (
              other.status === "pending" &&
              other.position < row.position &&
              candidate.kind === "purchase" &&
              +(importDate(candidate.date) ?? 0) === +at &&
              candidate.amountPaid === data.amountPaid &&
              candidate.units !== null &&
              candidate.units * (volumeFactor(candidate.volumeUnit) ?? 1) === data.units! * factor
            );
          });
          if (!existing && pendingDuplicate)
            result.issues.push(
              "An identical earlier payment is awaiting confirmation. Import it first to avoid recording the payment twice.",
            );
        }
      }
      if (data.kind === "usage" && meter && factor !== null) {
        const start = importDate(data.periodStart);
        const end = importDate(data.periodEnd);
        if (!start || !end || end <= start || data.units === null)
          result.issues.push(
            "Period usage requires units used, an unambiguous start, and an end later than the start. End time is exclusive.",
          );
        else {
          this.assertDecimal(data.units * factor, 999999999999.99);
          const overlap = await db.waterMeterUsageInterval.findFirst({
            where: { meterId: meter.id, periodStart: { lt: end }, periodEnd: { gt: start } },
          });
          if (overlap) {
            if (
              +overlap.periodStart === +start &&
              +overlap.periodEnd === +end &&
              Number(overlap.units) === data.units * factor
            ) {
              result.status = "duplicate";
              result.targetId = overlap.id;
            } else
              result.issues.push(
                "An overlapping period usage record already exists. Resolve it before importing this total.",
              );
          }
          const conflicts = (
            context.groups.get(data.meterNumber!.trim().toLowerCase()) ?? []
          ).filter((other) => {
            const candidate = other.data as unknown as ImportRecord;
            const from = importDate(candidate.periodStart);
            const to = importDate(candidate.periodEnd);
            return (
              other.id !== row.id &&
              other.status === "pending" &&
              candidate.kind === "usage" &&
              from &&
              to &&
              from < end &&
              to > start
            );
          });
          if (conflicts.length && !overlap) {
            const different = conflicts.some((other) => {
              const candidate = other.data as unknown as ImportRecord;
              return (
                +(importDate(candidate.periodStart) ?? 0) !== +start ||
                +(importDate(candidate.periodEnd) ?? 0) !== +end ||
                candidate.units !== data.units ||
                candidate.volumeUnit !== data.volumeUnit
              );
            });
            if (different || conflicts.some((other) => other.position < row.position))
              result.issues.push(
                "Another pending usage row overlaps this period. Resolve overlaps or import the first identical total before confirming this row.",
              );
          }
          result.warnings.push({
            code: "period_total",
            severity: "warning",
            message:
              "This is consumption over a date range, not a dial total or a purchase. Reports use it only where measured reading coverage is unavailable.",
          });
        }
      }
      if (["meter", "customer"].includes(data.kind)) {
        for (const field of [
          "meterNumber",
          "customerName",
          "zone",
          "name",
          "location",
          "plotNo",
          "phone",
        ] as const)
          if ((data[field]?.length ?? 0) > 191)
            result.issues.push(`${field} exceeds 191 characters.`);
        result.zoneId = await this.resolveZone(data.zone, db);
        if (data.kind === "meter") {
          if (meter) {
            result.status = "duplicate";
            result.targetId = meter.id;
          }
          if (
            !meter &&
            (context.groups.get(data.meterNumber!.trim().toLowerCase()) ?? []).some(
              (other) =>
                other.position < row.position &&
                other.status === "pending" &&
                (other.data as unknown as ImportRecord).kind === "meter",
            )
          )
            result.issues.push(
              "An earlier row already proposes this meter registration. Confirm that row first.",
            );
          if (!data.meterType)
            result.issues.push("Choose main, bulk, or household explicitly for a new meter.");
          if (data.meterType === "main" && !data.mainStage)
            result.issues.push("Specify which network stage this main meter measures.");
          if (["main", "bulk"].includes(data.meterType || "") && !data.name?.trim())
            result.issues.push("Main and bulk meters need a descriptive name.");
          result.warnings.push({
            code: "register_meter",
            severity: "warning",
            message:
              "This row registers a meter. Confirm its meter type, zone, and household customer before creating it.",
          });
        }
        if (data.kind === "customer" && !data.customerName?.trim())
          result.issues.push("Enter the customer's name.");
        if (data.customerName) {
          const customers = await db.waterCustomer.findMany({
            where: { name: data.customerName.trim(), zoneId: result.zoneId ?? null },
            take: 2,
          });
          if (customers.length > 1)
            result.issues.push(
              "More than one customer matches this name and zone. Resolve the customer through the normal meter form first.",
            );
          if (customers.length === 1) {
            result.customerId = customers[0].id;
            if (data.kind === "customer") {
              result.status = "duplicate";
              result.targetId = customers[0].id;
            }
          }
        }
      }
    } catch (error) {
      result.issues.push(
        error instanceof Error ? error.message : "This record could not be validated.",
      );
    }
    if (data.kind === "ignored") {
      result.issues =
        (data.notes?.trim().length ?? 0) < 5
          ? ["Give a reason for excluding this source row."]
          : [];
      result.warnings = [];
      result.status = "ignored";
    }
    if (result.issues.length) result.status = "blocked";
    else if (result.status === "ready" && result.warnings.length) result.status = "warning";
    const secret = this.config.get<string>("JWT_ACCESS_SECRET");
    if (!secret) throw new Error("Import confirmation signing is not configured.");
    result.reviewToken = createHmac("sha256", secret)
      .update(
        JSON.stringify({
          userId,
          id: row.id,
          data: row.data,
          updatedAt: row.updatedAt,
          status: result.status,
          issues: result.issues,
          warnings: result.warnings,
          meterId: result.meterId,
          targetId: result.targetId,
          zoneId: result.zoneId,
          customerId: result.customerId,
          readingToken: result.reading?.reviewToken,
        }),
      )
      .digest("base64url");
    return result;
  }

  private async write(
    data: ImportRecord,
    review: ImportReview,
    user: AuthenticatedUser,
    reason: string | undefined,
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<{ id: string }> {
    const save = async <T extends { id: string }>(type: WaterEntityType, pending: Promise<T>) => {
      const record = await pending;
      await this.removal.track(tx, "ai", batchId, type, record);
      return record;
    };
    const factor = volumeFactor(data.volumeUnit)!;
    if (data.kind === "reading")
      return save(
        "reading",
        this.readings.createReviewed(
          { ...review.dto!, reviewToken: review.reading!.reviewToken, reviewReason: reason },
          user,
          review.reading!,
          tx,
        ),
      );
    if (data.kind === "purchase") {
      const meter = await tx.waterMeter.findUniqueOrThrow({
        where: { id: review.meterId! },
        include: { customer: true },
      });
      return save(
        "purchase",
        tx.waterUsageRecord.create({
          data: {
            meterId: meter.id,
            customerId: meter.customerId,
            customerName:
              data.customerName || meter.customer?.name || `Account ${data.meterNumber}`,
            unitsSold: data.units! * factor,
            amountPaid: data.amountPaid!,
            recordedAt: importDate(data.date)!,
            source: "upload",
          },
        }),
      );
    }
    if (data.kind === "usage")
      return save(
        "usage",
        tx.waterMeterUsageInterval.create({
          data: {
            meterId: review.meterId!,
            periodStart: importDate(data.periodStart)!,
            periodEnd: importDate(data.periodEnd)!,
            units: data.units! * factor,
            notes: data.notes,
            createdBy: user.id,
          },
        }),
      );
    let customerId = review.customerId;
    if (
      data.customerName &&
      !customerId &&
      (data.kind === "customer" || data.meterType === "household")
    ) {
      const matches = await tx.waterCustomer.findMany({
        where: { name: data.customerName.trim(), zoneId: review.zoneId ?? null },
        take: 2,
      });
      if (matches.length > 1)
        throw new ConflictException(
          "Customer identity became ambiguous. Review the matching customers before confirming.",
        );
      customerId =
        matches[0]?.id ??
        (
          await save(
            "customer",
            tx.waterCustomer.create({
              data: { name: data.customerName.trim(), phone: data.phone, zoneId: review.zoneId },
            }),
          )
        ).id;
    }
    if (data.kind === "customer") return { id: customerId! };
    return save(
      "meter",
      tx.waterMeter.create({
        data: {
          meterNumber: data.meterNumber!.trim(),
          meterType: data.meterType!,
          mainStage: data.meterType === "main" ? data.mainStage : null,
          name: data.meterType === "household" ? null : data.name,
          location: data.location,
          zoneId: review.zoneId,
          customerId: data.meterType === "household" ? customerId : null,
          plotNo: data.plotNo,
          vendingSystem: data.vendingSystem ?? "amsol",
        },
      }),
    );
  }

  private async resolveZone(name: string | null, db: WaterDatabase) {
    if (!name?.trim()) return null;
    const parts = name.split("/").map((part) => part.trim());
    let parentZoneId: string | null | undefined;
    for (const part of parts) {
      const matches = await db.waterZone.findMany({
        where: { name: part, ...(parentZoneId !== undefined && { parentZoneId }) },
        take: 2,
      });
      if (matches.length !== 1)
        throw new BadRequestException(
          `Zone '${name}' is missing or ambiguous. Use its full path, such as Estate / Zone A.`,
        );
      parentZoneId = matches[0].id;
    }
    return parentZoneId ?? null;
  }

  private stagedReadings(
    rows: WaterImportRow[],
    meterType: string,
    exceptId: string,
  ): ReadingObservation[] {
    return rows
      .filter((row) => row.id !== exceptId && row.status === "pending")
      .flatMap((row) => {
        const data = row.data as unknown as ImportRecord;
        const date = importDate(data.date);
        const factor = volumeFactor(data.volumeUnit);
        if (data.kind !== "reading" || !date || factor === null) return [];
        const value = meterType === "household" ? data.remainingBalance : data.dialReading;
        return [
          {
            id: row.id,
            readingDate: date,
            value: value === null ? null : value * factor,
            cumulativeUsage: data.cumulativeUsage === null ? null : data.cumulativeUsage * factor,
          },
        ];
      });
  }

  private async context(batchId: string, db: WaterDatabase = this.prisma): Promise<RowContext> {
    const rows = await db.waterImportRow.findMany({
      where: { batchId },
      orderBy: { position: "asc" },
    });
    const groups = new Map<string, WaterImportRow[]>();
    for (const row of rows) {
      const number = (row.data as unknown as ImportRecord).meterNumber?.trim().toLowerCase();
      if (number) {
        const group = groups.get(number) ?? [];
        group.push(row);
        groups.set(number, group);
      }
    }
    return { rows, groups };
  }

  private async batch(id: string, db: WaterDatabase = this.prisma) {
    const batch = await db.waterImportBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException("Import not found.");
    return batch;
  }

  private previewToken(batch: { id: string; previewVersion: number }, userId: string) {
    return createHmac("sha256", this.config.getOrThrow<string>("JWT_ACCESS_SECRET"))
      .update(JSON.stringify({ id: batch.id, version: batch.previewVersion ?? 0, userId }))
      .digest("base64url");
  }

  private requirePreview(
    batch: { id: string; previewVersion: number },
    userId: string,
    token?: string,
  ) {
    if (!token || token !== this.previewToken(batch, userId))
      throw new ConflictException(
        "Open the complete extraction preview and review the latest corrections before confirming this import.",
      );
  }

  private presentBatch<T extends { storageKey: string; fileHash: string; leaseUntil: Date | null }>(
    batch: T,
  ) {
    const {
      storageKey: _storageKey,
      fileHash: _fileHash,
      leaseUntil: _leaseUntil,
      ...visible
    } = batch;
    return visible;
  }

  private assertDecimal(value: number, maximum: number) {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > maximum ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.00001
    )
      throw new BadRequestException(
        "The converted value must fit the system's two decimal places. Correct it explicitly; values are never rounded silently.",
      );
  }
}
