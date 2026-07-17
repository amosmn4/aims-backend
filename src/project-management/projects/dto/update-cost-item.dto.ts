import { PartialType } from "@nestjs/mapped-types";
import { CreateCostItemDto } from "./create-cost-item.dto";

export class UpdateCostItemDto extends PartialType(CreateCostItemDto) {}
