import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import cookieParser from "cookie-parser";
import compression from "compression";
import { AppModule } from "./app.module";
import type { EnvConfig } from "./config/env.validation";
import { PrismaExceptionFilter } from "./common/prisma-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<EnvConfig>);

  // gzip/brotli-negotiated compression on every response — JSON payloads (list endpoints
  // especially) commonly shrink 70-90%, which is most of the win on a slow/mobile connection.
  app.use(compression());
  app.use(cookieParser());
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.enableCors({
    // Hardcoded localhost fallback only applies when CORS_ORIGIN is absent from the validated
    // environment (.env not reached, or set with no value) — never overrides a real .env value.
    origin: configService.get("CORS_ORIGIN") ?? "http://localhost:3000",
    credentials: true,
  });

  const port = configService.get("PORT") ?? 4000;
  await app.listen(port);
}

bootstrap();
