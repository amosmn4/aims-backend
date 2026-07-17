import { PartialType } from "@nestjs/mapped-types";
import { CreateTenderPricingItemDto } from "./create-tender-pricing-item.dto";

export class UpdateTenderPricingItemDto extends PartialType(CreateTenderPricingItemDto) {}
