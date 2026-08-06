import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 25;

/**
 * Every list endpoint supports pagination, but opt-in per request rather than a breaking
 * response-shape change everywhere at once: a caller that passes neither `page` nor `pageSize`
 * gets today's plain, unbounded array back (dropdown/picker call sites keep working untouched);
 * a caller that passes either gets `{ data, total, page, pageSize }`. Same query args either way
 * — just skip/take added when pagination is actually requested.
 */
export async function maybePaginate<T>(
  // `any` here (not `unknown`) deliberately — Prisma's generated per-model delegate types
  // (ClientDelegate, UserDelegate, …) each have their own precise `where`/`count` argument
  // types that don't structurally unify under a shared generic signature; `any` is what lets
  // any of them be passed to this one shared helper without a cast at every call site.
  model: {
    findMany: (args: any) => Promise<T[]>;
    count: (args: any) => Promise<number>;
  },
  args: { where?: unknown; include?: unknown; select?: unknown; orderBy?: unknown },
  query: { page?: number; pageSize?: number },
): Promise<T[] | Paginated<T>> {
  if (!query.page && !query.pageSize) {
    return model.findMany(args);
  }

  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 100) : DEFAULT_PAGE_SIZE;

  const [data, total] = await Promise.all([
    model.findMany({ ...args, skip: (page - 1) * pageSize, take: pageSize }),
    model.count({ where: args.where }),
  ]);

  return { data, total, page, pageSize };
}
