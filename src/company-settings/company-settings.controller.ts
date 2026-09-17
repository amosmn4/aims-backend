import { Body, Controller, Get, Patch } from "@nestjs/common";
import { CompanySettingsService } from "./company-settings.service";
import { UpdateCompanySettingsDto } from "./dto/update-company-settings.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

@Controller("company-settings")
export class CompanySettingsController {
  constructor(private readonly settings: CompanySettingsService) {}

  /** Name, logo and support contact for the sign-in pages. */
  @Public()
  @Get("public")
  async publicInfo() {
    const s = await this.settings.get();
    return {
      companyName: s.companyName,
      logoDataUrl: s.logoDataUrl,
      supportContactName: s.supportContactName,
      supportContactEmail: s.supportContactEmail,
    };
  }

  @Get()
  @Roles()
  get() {
    return this.settings.get();
  }

  @Patch()
  @Roles()
  update(@Body() dto: UpdateCompanySettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.update(dto, user);
  }
}
