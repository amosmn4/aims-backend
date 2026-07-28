import { Module } from "@nestjs/common";
import { BlogController } from "./blog.controller";
import { PublicBlogController } from "./public-blog.controller";
import { BlogService } from "./blog.service";
import { StorageModule } from "../../storage/storage.module";

@Module({
  imports: [StorageModule],
  controllers: [BlogController, PublicBlogController],
  providers: [BlogService],
})
export class BlogModule {}
