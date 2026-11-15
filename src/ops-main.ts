import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import compression from "compression";
import { parseCorsOrigins } from "./config/env.validation";
import { PrismaExceptionFilter } from "./common/prisma-exception.filter";
import { SanitizeInputPipe } from "./common/sanitize";
import { OpsApplicationModule } from "./ops/ops-application.module";
import { validateOpsProduction } from "./ops/ops-production-config";

async function bootstrap() {
  const app = await NestFactory.create(OpsApplicationModule);
  const config = app.get(ConfigService);
  validateOpsProduction(config);
  const proxyHops = config.get<number>("OPS_TRUST_PROXY_HOPS", 0);
  app
    .getHttpAdapter()
    .getInstance()
    .set("trust proxy", proxyHops || false);
  app.use(compression());
  app.use(cookieParser());
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new SanitizeInputPipe(),
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.enableCors({ origin: parseCorsOrigins(config.get("CORS_ORIGIN")), credentials: true });
  app.enableShutdownHooks();
  await app.listen(
    config.get<number>("OPS_PORT", 4002),
    config.get<string>("OPS_HOST", "127.0.0.1"),
  );
}

void bootstrap();
