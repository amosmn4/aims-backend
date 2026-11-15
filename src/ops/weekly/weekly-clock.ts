import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class WeeklyClock {
  constructor(private readonly config: ConfigService) {}
  now() {
    const fixture = this.config.get<string>("OPS_WEEKLY_TEST_NOW");
    return this.config.get("NODE_ENV") === "test" && fixture ? new Date(fixture) : new Date();
  }
}
