import { ScheduleModule } from "@nestjs/schedule";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { validateEnv } from "../config/env.validation";
import { PrismaModule } from "../prisma/prisma.module";
import { OpsModule } from "./ops.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    ThrottlerModule.forRoot([{ name: "default", ttl: 60000, limit: 120 }]),
    OpsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class OpsApplicationModule {}
