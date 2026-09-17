import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { isAdminOrCeo } from "../common/is-admin-or-ceo";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import type { UpdateCompanySettingsDto } from "./dto/update-company-settings.dto";

const SETTINGS_ID = "company";

@Injectable()
export class CompanySettingsService {
  constructor(private readonly prisma: PrismaService) {}

  get() {
    return this.prisma.companySettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID },
      update: {},
    });
  }

  async update(dto: UpdateCompanySettingsDto, user: AuthenticatedUser) {
    if (!isAdminOrCeo(user))
      throw new ForbiddenException("Only the CEO can change company settings");
    await this.get();
    return this.prisma.companySettings.update({
      where: { id: SETTINGS_ID },
      data: {
        ...dto,
        supportContactName:
          dto.supportContactName === undefined ? undefined : dto.supportContactName?.trim() || null,
        supportContactEmail:
          dto.supportContactEmail === undefined
            ? undefined
            : dto.supportContactEmail?.trim() || null,
        updatedBy: user.id,
      },
    });
  }
}
