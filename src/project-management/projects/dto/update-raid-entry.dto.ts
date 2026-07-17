import { PartialType } from "@nestjs/mapped-types";
import { CreateRaidEntryDto } from "./create-raid-entry.dto";

export class UpdateRaidEntryDto extends PartialType(CreateRaidEntryDto) {}
