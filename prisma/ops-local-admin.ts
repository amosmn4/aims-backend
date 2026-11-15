import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { z } from "zod";
import { bootstrapOps } from "./ops-bootstrap";

export function localAdminConfig(env: NodeJS.ProcessEnv) {
  const database = new URL(env.DATABASE_URL || "");
  if (
    env.NODE_ENV !== "development" ||
    database.protocol !== "mysql:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
  )
    throw new Error("Local admin setup requires NODE_ENV=development and a local MySQL database.");
  const email = z.string().trim().toLowerCase().email().max(200).safeParse(env.SEED_ADMIN_EMAIL);
  const password = z.string().min(1).max(72).safeParse(env.SEED_ADMIN_PASSWORD);
  if (!email.success || !password.success || Buffer.byteLength(password.data, "utf8") > 72)
    throw new Error("Set valid SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD values in backend/.env.");
  return { email: email.data, password: password.data };
}

export async function setupLocalOpsAdmin(db: PrismaClient, env: NodeJS.ProcessEnv) {
  const { email, password } = localAdminConfig(env);
  const existing = await db.user.findUnique({ where: { email } });
  let userId: string;
  if (existing) {
    if (!existing.passwordHash || !(await bcrypt.compare(password, existing.passwordHash)))
      throw new Error(
        "The existing account uses a different password. Its password was preserved.",
      );
    userId = existing.id;
  } else {
    const user = await db.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 12),
        fullName: "System Administrator",
        isActive: true,
        roles: { create: { role: "system_admin" } },
      },
    });
    userId = user.id;
  }
  await db.userRole.deleteMany({ where: { userId, role: "ceo" } });
  await db.userRole.upsert({
    where: { userId_role: { userId, role: "system_admin" } },
    create: { userId, role: "system_admin" },
    update: {},
  });
  await bootstrapOps(db, email);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  setupLocalOpsAdmin(prisma, process.env)
    .then(() =>
      process.stdout.write("Local Ops admin is ready. Sign in using backend/.env credentials.\n"),
    )
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Local admin setup failed."}\n`,
      );
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
