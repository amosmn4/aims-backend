import { describe, expect, it, jest } from "@jest/globals";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import type { AiService } from "../ai/ai.service";
import { WaterFileExtractionService } from "./water-file-extraction.service";
import { emptyImportRecord } from "./water-import.types";

function fixture() {
  const extract = jest.fn(async (_request: unknown) => ({
    complete: true,
    records: [
      {
        sourceText: "Meter B01, 2026-01-10, dial 22000",
        data: {
          ...emptyImportRecord(),
          kind: "reading",
          meterNumber: "B01",
          date: "2026-01-10",
          dialReading: 22000,
        },
      },
    ],
    unreadable: [],
  }));
  return {
    extract,
    service: new WaterFileExtractionService({ extract } as unknown as AiService),
    progress: jest.fn(async (_done: number, _total: number) => undefined),
  };
}

describe("Water file extraction", () => {
  it("reads all 1001 CSV records, preserves leading-zero meters, and does not call AI for known headings", async () => {
    const { service, extract, progress } = fixture();
    const csv =
      "Meter,Date,Dial reading\n" +
      Array.from({ length: 1001 }, (_, index) => `000${index},2026-01-10,${22000 + index}`).join(
        "\n",
      );
    const rows = await service.extract(Buffer.from(csv), "bulk-readings.csv", progress);
    expect(rows).toHaveLength(1001);
    expect(rows[0].data).toMatchObject({
      meterNumber: "0000",
      dialReading: 22000,
      kind: "reading",
    });
    expect(rows[1000].data.dialReading).toBe(23000);
    expect(extract).not.toHaveBeenCalled();
  });

  it("reads every worksheet and keeps missing units uncaptured", async () => {
    const { service, progress } = fixture();
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Meter", "Date", "Remaining balance", "Cumulative usage"],
        ["000123", 46032, 10, 519],
      ]),
      "Balances",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Meter", "Date", "Amount", "Units", "Name"],
        ["000123", "2026-01-10", 500, null, "Payer Name"],
      ]),
      "Payments",
    );
    const rows = await service.extract(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      "records.xlsx",
      progress,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].data).toMatchObject({
      meterNumber: "000123",
      remainingBalance: 10,
      cumulativeUsage: 519,
    });
    expect(rows[0].data.date).toMatch(/\+03:00$/);
    expect(rows[1].data).toMatchObject({
      units: null,
      amountPaid: 500,
      customerName: "Payer Name",
      kind: "purchase",
    });
  });

  it("preserves display-formatted leading zeros in numeric Excel meter numbers", async () => {
    const { service, progress } = fixture();
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Meter", "Date", "Dial reading"],
      [123, "2026-01-10", 22000],
    ]);
    sheet.A2.z = "000000";
    XLSX.utils.book_append_sheet(workbook, sheet, "Readings");
    const rows = await service.extract(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      "readings.xlsx",
      progress,
    );
    expect(rows[0].data.meterNumber).toBe("000123");
  });

  it("splits a source row containing a reading and a payment into both destinations", async () => {
    const { service, progress } = fixture();
    const rows = await service.extract(
      Buffer.from(
        "Meter,Date,Remaining balance,Cumulative usage,Units,Amount\n000123,2026-01-10,10,519,5,100",
      ),
      "mixed.csv",
      progress,
    );
    expect(rows.map((row) => row.data.kind)).toEqual(["reading", "purchase"]);
    expect(rows.every((row) => row.raw["1: Meter"] === "000123")).toBe(true);
  });

  it("extracts every PDF page separately rather than summarizing the file", async () => {
    const { service, extract, progress } = fixture();
    const document = await PDFDocument.create();
    for (let index = 0; index < 3; index++) document.addPage();
    const rows = await service.extract(
      Buffer.from(await document.save()),
      "readings.pdf",
      progress,
    );
    expect(extract).toHaveBeenCalledTimes(3);
    expect(rows.map((row) => row.source)).toEqual([
      "Page 1, record 1",
      "Page 2, record 1",
      "Page 3, record 1",
    ]);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });

  it("reads a real Word document without losing its text to an empty extraction", async () => {
    const { service, extract, progress } = fixture();
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      "_rels/.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    zip.file(
      "word/document.xml",
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Meter B01, 2026-01-10, dial 22000</w:t></w:r></w:p></w:body></w:document>',
    );
    const rows = await service.extract(
      await zip.generateAsync({ type: "nodebuffer" }),
      "readings.docx",
      progress,
    );
    expect(rows).toHaveLength(1);
    expect(extract).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Meter B01, 2026-01-10, dial 22000"),
      }),
    );
  });

  it("refuses to present incomplete AI extraction as a successful import", async () => {
    const { service, extract, progress } = fixture();
    extract.mockResolvedValue({ complete: false, records: [], unreadable: [] });
    await expect(service.extract(Buffer.from("image"), "readings.png", progress)).rejects.toThrow(
      "could not be extracted completely",
    );
  });
});
