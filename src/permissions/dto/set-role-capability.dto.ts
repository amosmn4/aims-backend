import { IsBoolean, IsString } from "class-validator";

export class SetRoleCapabilityDto {
  @IsString()
  role!: string;

  @IsString()
  capability!: string;

  @IsBoolean()
  allowed!: boolean;
}
