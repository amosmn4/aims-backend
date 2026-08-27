import { Module } from "@nestjs/common";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";
import { DocumentsModule } from "../documents/documents.module";

@Module({
  imports: [DocumentsModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
