import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { Prisma } from "@prisma/client";

// Translates the two Prisma error codes that show up as raw 500s whenever a service doesn't
// pre-check for them (delete blocked by a Restrict foreign key, or a record that vanished
// between lookup and mutation) into clean, predictable HTTP responses — a safety net for every
// delete/update in the app, not just the ones with their own explicit pre-checks.
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception.code === "P2003") {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: "This record is still referenced by other data and can't be deleted.",
      });
      return;
    }

    if (exception.code === "P2025") {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: "Record not found.",
      });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Something went wrong.",
    });
  }
}
