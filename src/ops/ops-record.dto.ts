import { Allow } from "class-validator";
import { AllowHtml } from "../common/sanitize";
import { schemas } from "./ops.schemas";

export class OpsRecordBody {
  [key: string]: unknown;
  id!: string;
}

for (const field of new Set(Object.values(schemas).flatMap((schema) => Object.keys(schema.shape))))
  Allow()(OpsRecordBody.prototype, field);
for (const field of ["summary", "description", "subtasks", "progress", "blockers", "next"])
  AllowHtml()(OpsRecordBody.prototype, field);
