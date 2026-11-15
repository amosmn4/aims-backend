import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const departments = [
  {
    id: "hr",
    name: "HR Services",
    blurb: "HR consultancy, recruitment and training",
    modules: ["Client accounts", "Recruitment pipeline", "Training sessions"],
  },
  {
    id: "finance",
    name: "Finance",
    blurb: "Payroll, project finances and business reporting",
    modules: ["Payroll runs", "Project budgets", "Sister companies"],
  },
  {
    id: "it",
    name: "IT",
    blurb: "Systems, databases and internal tools",
    modules: ["Systems register", "Support tickets", "Database health"],
  },
  {
    id: "marketing",
    name: "Marketing",
    blurb: "Brand, content and campaigns",
    modules: ["Content calendar", "Social posts", "Campaigns"],
  },
  {
    id: "operations",
    name: "Operations",
    blurb: "Client requests and service delivery",
    modules: ["Client requests", "SLA tracker", "Escalations"],
  },
];

export async function bootstrapOps(db: PrismaClient, email: string) {
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { roles: true },
  });
  if (
    !user?.isActive ||
    !user.passwordHash ||
    !user.roles.some((role) => role.role === "ceo" || role.role === "system_admin")
  )
    throw new Error("Choose an active existing CEO or system administrator with a password.");
  const opsRole = user.roles.some((role) => role.role === "system_admin") ? "system_admin" : "ceo";
  await db.$transaction(async (tx) => {
    await tx.opsState.upsert({
      where: { id: "workspace" },
      create: {
        id: "workspace",
        settings: {
          company: "Amsol Ops",
          reminderDays: 7,
          remindersEnabled: true,
          defaultDocumentAccess: "department",
        },
      },
      update: { revision: { increment: 1 } },
    });
    for (const dept of departments)
      await tx.opsDepartment.upsert({ where: { id: dept.id }, create: dept, update: {} });
    await tx.opsBusiness.upsert({
      where: { id: "b0" },
      create: { id: "b0", name: "Amsol", sector: "Professional services" },
      update: {},
    });
    const existing = await tx.opsStaff.findUnique({ where: { userId: user.id } });
    if (!existing)
      await tx.opsStaff.create({
        data: {
          userId: user.id,
          name: user.fullName || user.email,
          title: user.jobTitle || "Chief Executive Officer",
          role: opsRole,
          active: true,
        },
      });
    else if (existing.role !== opsRole || !existing.active) {
      if (existing.role === "ceo" && opsRole === "system_admin" && existing.active)
        await tx.opsStaff.update({ where: { id: existing.id }, data: { role: "system_admin" } });
      else
        throw new Error(
          "This identity already has a different Ops profile. Resolve it through Ops administration.",
        );
    }
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "ops.bootstrapped",
        entityType: "ops",
        entityId: "workspace",
      },
    });
  });
}

if (require.main === module) {
  const email = process.argv[2];
  if (!email) {
    process.stderr.write("Usage: npm run ops:bootstrap -- existing-ceo@example.com\n");
    process.exitCode = 1;
  } else
    bootstrapOps(prisma, email)
      .then(() =>
        process.stdout.write("Ops initialized. Existing operational records were not imported.\n"),
      )
      .catch((error: unknown) => {
        process.stderr.write(
          `${error instanceof Error ? error.message : "Ops bootstrap failed."}\n`,
        );
        process.exitCode = 1;
      })
      .finally(() => prisma.$disconnect());
}
