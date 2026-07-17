import { PartialType } from "@nestjs/mapped-types";
import { CreateClientRequestDto } from "./create-client-request.dto";

export class UpdateClientRequestDto extends PartialType(CreateClientRequestDto) {}
