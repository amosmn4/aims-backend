import { PartialType } from "@nestjs/mapped-types";
import { CreateItSystemDto } from "./create-it-system.dto";

export class UpdateItSystemDto extends PartialType(CreateItSystemDto) {}
