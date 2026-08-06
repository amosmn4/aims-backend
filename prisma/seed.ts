import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

const DEPARTMENTS = [
  { code: "operations", name: "Operations", isCore: true, sortOrder: 0 },
  { code: "finance", name: "Finance", isCore: true, sortOrder: 1 },
  { code: "hr", name: "Human Resources", isCore: true, sortOrder: 2 },
  { code: "it", name: "Information Technology", isCore: true, sortOrder: 3 },
  { code: "marketing", name: "Marketing", isCore: true, sortOrder: 4 },
  { code: "tender", name: "Tender", isCore: true, sortOrder: 5 },
];

// Mirrors Amsol's product/service list from the AIMS requirements doc.
const SERVICE_LINES = [
  { code: "PAYROLL", name: "Payroll Processing & Management", isRecurring: true, sortOrder: 1 },
  { code: "HR_MGMT", name: "HR Management Services", isRecurring: true, sortOrder: 2 },
  { code: "RECRUITMENT", name: "Recruitment", isRecurring: false, sortOrder: 3 },
  { code: "TRAINING", name: "Training", isRecurring: false, sortOrder: 4 },
  { code: "SALARY_SURVEY", name: "Salary Surveys", isRecurring: false, sortOrder: 5 },
  { code: "HRMS", name: "HRMS Software Licensing", isRecurring: true, sortOrder: 6 },
  { code: "ADVISORY", name: "Other HR Advisory Services", isRecurring: false, sortOrder: 7 },
];

// Reference/lookup data only — Departments, Service Lines, the HQ Office and a single bootstrap
// System Administrator. No demo clients, contracts, projects, tenders or staff accounts: real use
// starts from a clean database, with the admin below inviting every other real user through
// Admin > Users (see UsersService.create — that flow emails a set-password link, or surfaces the
// raw link when SMTP isn't configured).
async function main() {
  for (const dept of DEPARTMENTS) {
    await prisma.department.upsert({ where: { code: dept.code }, create: dept, update: dept });
  }

  for (const sl of SERVICE_LINES) {
    await prisma.serviceLine.upsert({ where: { code: sl.code }, create: sl, update: sl });
  }

  const hqOffice = await prisma.office.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Nairobi HQ",
      country: "Kenya",
      city: "Nairobi",
      currencyCode: "KES",
      isHq: true,
    },
    update: {},
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@amsol.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe!2026";
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash,
      fullName: "System Administrator",
      officeId: hqOffice.id,
      isActive: true,
    },
    update: {},
  });

  for (const role of ["system_admin", "ceo"] as const) {
    await prisma.userRole.upsert({
      where: { userId_role: { userId: admin.id, role } },
      create: { userId: admin.id, role },
      update: {},
    });
  }

  console.log(`Seed complete — ${DEPARTMENTS.length} departments, ${SERVICE_LINES.length} service lines, 1 office, 1 System Administrator (${adminEmail}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
