import { PartialType, OmitType } from "@nestjs/mapped-types";
import { CreateHrmsLicenseDto } from "./create-hrms-license.dto";

// clientId is set once at creation (the unique FK) — not editable afterward.
export class UpdateHrmsLicenseDto extends PartialType(OmitType(CreateHrmsLicenseDto, ["clientId"] as const)) {}
