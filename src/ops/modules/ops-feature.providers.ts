import { WaterService } from "../../water/water.service";
import { WaterAiService } from "../../water/water-ai.service";
import { WaterReadingReviewService } from "../../water/water-reading-review.service";
import { WaterFileExtractionService } from "../../water/water-file-extraction.service";
import { WaterImportSuggestionsService } from "../../water/water-import-suggestions.service";
import { WaterExpensesService } from "../../water/water-expenses.service";
import { ExpensesService } from "../../finance/expenses/expenses.service";
import { AiService } from "../../ai/ai.service";
import { AiAssistantService } from "../../ai/ai-assistant.service";
import { AiChatService } from "../../ai/ai-chat.service";
import { ReportAccessService } from "../../reports/report-access.service";
import { BlogService } from "../../marketing/blog/blog.service";
import { AiDataService } from "../../ai/ai-data.service";
import { DocumentsService } from "../../documents/documents.service";
import { OpsWaterDataService, OpsWaterDocuments } from "./ops-water-data.service";

export const opsFeatureProviders = [
  WaterService,
  WaterAiService,
  WaterReadingReviewService,
  WaterFileExtractionService,
  WaterImportSuggestionsService,
  WaterExpensesService,
  ExpensesService,
  AiService,
  AiAssistantService,
  AiChatService,
  ReportAccessService,
  BlogService,
  { provide: AiDataService, useClass: OpsWaterDataService },
  { provide: DocumentsService, useClass: OpsWaterDocuments },
];
