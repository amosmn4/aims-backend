import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import cookieParser from "cookie-parser";
import compression from "compression";
import { AppModule } from "./app.module";
import { parseCorsOrigins, type EnvConfig } from "./config/env.validation";
import { PrismaExceptionFilter } from "./common/prisma-exception.filter";
import { SanitizeInputPipe } from "./common/sanitize";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<EnvConfig>);

  // gzip/brotli-negotiated compression on every response — JSON payloads (list endpoints
  // especially) commonly shrink 70-90%, which is most of the win on a slow/mobile connection.
  app.use(compression());
  app.use(cookieParser());
  // Feed `cover`/`video` paths lack /api/v1; accept both forms so `apiBase + post.cover` resolves either way.
  app.use((req: { url: string }, _res: unknown, next: () => void) => {
    if (/^\/public\/blog\/(images|videos)\//.test(req.url)) req.url = `/api/v1${req.url}`;
    next();
  });
  app.setGlobalPrefix("api/v1");
  // Strip HTML from every text input first, then validate.
  app.useGlobalPipes(
    new SanitizeInputPipe(),
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.enableCors({
    // Hardcoded localhost fallback only applies when CORS_ORIGIN is absent from the validated
    // environment (.env not reached, or set with no value) — never overrides a real .env value.
    // See parseCorsOrigins for why this must be an array, not the raw comma-joined string.
    origin: parseCorsOrigins(configService.get("CORS_ORIGIN")),
    credentials: true,
  });

  const port = configService.get("PORT") ?? 4000;
  await app.listen(port);
}

bootstrap();
