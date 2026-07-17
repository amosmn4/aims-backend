import { PartialType } from "@nestjs/mapped-types";
import { CreateRaciEntryDto } from "./create-raci-entry.dto";

export class UpdateRaciEntryDto extends PartialType(CreateRaciEntryDto) {}
