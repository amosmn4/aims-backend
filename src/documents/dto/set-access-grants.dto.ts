import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, ValidateNested } from "class-validator";

const ACCESS_TYPES = ["everyone", "department", "user"] as const;

export class AccessGrantInput {
  @IsIn(ACCESS_TYPES)
  accessType!: (typeof ACCESS_TYPES)[number];

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class SetAccessGrantsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AccessGrantInput)
  grants!: AccessGrantInput[];
}
