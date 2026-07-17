import { Module } from "@nestjs/common";
import { ClientRequestsController } from "./client-requests.controller";
import { ClientRequestsService } from "./client-requests.service";
import { DocumentsModule } from "../../documents/documents.module";

@Module({
  imports: [DocumentsModule],
  controllers: [ClientRequestsController],
  providers: [ClientRequestsService],
  exports: [ClientRequestsService],
})
export class ClientRequestsModule {}
