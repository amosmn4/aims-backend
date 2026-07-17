import { IsOptional, IsString } from "class-validator";

export class RouteClientRequestDto {
  @IsString()
  departmentId!: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}
