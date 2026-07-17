import { PartialType } from "@nestjs/mapped-types";
import { CreateTenderCostItemDto } from "./create-tender-cost-item.dto";

export class UpdateTenderCostItemDto extends PartialType(CreateTenderCostItemDto) {}
