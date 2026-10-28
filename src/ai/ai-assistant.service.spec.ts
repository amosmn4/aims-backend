import { describe, expect, it, jest } from "@jest/globals";
import { ForbiddenException } from "@nestjs/common";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";
import { AiAssistantService } from "./ai-assistant.service";
import type { AiService, AiToolResult } from "./ai.service";
import type { AiDataService } from "./ai-data.service";
import type { DocumentsService } from "../documents/documents.service";
import type { StorageService } from "../storage/storage.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

const user: AuthenticatedUser = {
  id: "staff",
  email: "staff@example.test",
  roles: ["general_staff"],
  departmentId: null,
};
function fixture(buffer: Buffer, fileName: string, mimeType: string, pages = [1]) {
  const results: AiToolResult[] = [];
  const documents = {
    getFileForDownload: jest.fn(async (_id: string, _version: unknown, _user: unknown) => ({
      key: "private/document",
      fileName,
      mimeType,
    })),
  };
  const storage = { read: jest.fn(async (_key: string) => buffer) };
  const ai = {
    providerStatus: () => ({ openai: true, gemini: false }),
    withTools: async (
      _request: unknown,
      _tools: unknown,
      execute: (name: string, args: unknown) => Promise<AiToolResult>,
    ) => {
      for (const page of pages)
        results.push(await execute("read_document", { id: "document", page }));
      return { text: "Verified contents", provider: "openai" as const };
    },
  };
  const service = new AiAssistantService(
    ai as unknown as AiService,
    { catalog: () => [] } as unknown as AiDataService,
    documents as unknown as DocumentsService,
    storage as unknown as StorageService,
  );
  return { service, results, documents, storage };
}
describe("Assistant document reads", () => {
  it("reads later rows across every worksheet and retains page boundaries", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(Array.from({ length: 100 }, (_, i) => ["First " + i])),
      "First",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["Second sheet evidence"]]),
      "Second",
    );
    const { service, results, documents } = fixture(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer,
      "history.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      [1, 2],
    );
    await service.answer("Read the full spreadsheet", user);
    expect(documents.getFileForDownload).toHaveBeenCalledWith("document", undefined, user);
    expect(results[0].data).toMatchObject({ totalRows: 101, nextPage: 2 });
    expect(results[1].data).toMatchObject({
      page: 2,
      nextPage: null,
      rows: [{ sheet: "Second", row: 1, values: ["Second sheet evidence"] }],
    });
  });
  it("checks document permission before reading private storage", async () => {
    const { service, documents, storage } = fixture(
      Buffer.from("Private contents"),
      "private.txt",
      "text/plain",
    );
    documents.getFileForDownload.mockRejectedValueOnce(
      new ForbiddenException("Document access denied"),
    );
    await expect(service.answer("Read this document", user)).rejects.toThrow(
      "Document access denied",
    );
    expect(storage.read).not.toHaveBeenCalled();
  });
  it("supplies only the requested PDF page and reports remaining coverage", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 200]);
    pdf.addPage([300, 400]);
    const { service, results } = fixture(
      Buffer.from(await pdf.save()),
      "history.pdf",
      "application/pdf",
      [2],
    );
    await service.answer("Read the second page", user);
    expect(results[0].data).toMatchObject({ page: 2, totalPages: 2, nextPage: null });
    const supplied = await PDFDocument.load(results[0].file!.data);
    expect(supplied.getPageCount()).toBe(1);
    expect(supplied.getPage(0).getWidth()).toBe(300);
  });
});
