import { PartialType } from "@nestjs/mapped-types";
import { CreateTenderBondDto } from "./create-tender-bond.dto";

export class UpdateTenderBondDto extends PartialType(CreateTenderBondDto) {}
