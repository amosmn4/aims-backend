import { PrismaClient, type TenderStage } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

const DEPARTMENTS = [
  { code: "finance", name: "Finance", isCore: true, sortOrder: 1 },
  { code: "hr", name: "Human Resources", isCore: true, sortOrder: 2 },
  { code: "it", name: "Information Technology", isCore: true, sortOrder: 3 },
  { code: "marketing_ops", name: "Marketing & Operations", isCore: true, sortOrder: 4 },
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

// Deterministic "N months ago, day D" helper so seeded data always looks recent relative to
// whenever this script actually runs, instead of going stale after a fixed calendar date.
function monthsAgo(n: number, day = 15): Date {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  d.setDate(Math.min(day, 28));
  d.setHours(0, 0, 0, 0);
  return d;
}
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
}
// Interpolates a date between start/end at fraction [0,1] — used to spread a project's tasks
// across its own start/end window (proportional to estimated hours) so every task gets a real
// start/due date for the Gantt chart, not just the couple the old ad-hoc overdue/due-soon logic
// touched.
function dateAtFraction(start: Date, end: Date, frac: number): Date {
  const clamped = Math.max(0, Math.min(1, frac));
  const d = new Date(start.getTime() + (end.getTime() - start.getTime()) * clamped);
  d.setHours(0, 0, 0, 0);
  return d;
}

const STAFF = [
  { email: "grace.mwangi@amsol.com", fullName: "Grace Mwangi", dept: "finance", role: "finance" as const },
  { email: "peter.otieno@amsol.com", fullName: "Peter Otieno", dept: "hr", role: "hr" as const },
  { email: "samuel.kiptoo@amsol.com", fullName: "Samuel Kiptoo", dept: "it", role: "it" as const },
  { email: "amina.yusuf@amsol.com", fullName: "Amina Yusuf", dept: "marketing_ops", role: "marketing_ops" as const },
  { email: "david.mutua@amsol.com", fullName: "David Mutua", dept: "tender", role: "tender" as const },
  { email: "linda.achieng@amsol.com", fullName: "Linda Achieng", dept: "finance", role: "account_manager" as const },
];

const CLIENTS = [
  { code: "CL-004", name: "Savanna Foods Ltd", country: "Kenya", industry: "FMCG", segment: "Enterprise" },
  { code: "CL-005", name: "Kampala Traders Co", country: "Uganda", industry: "Retail", segment: "SME" },
  { code: "CL-006", name: "Serengeti Logistics", country: "Tanzania", industry: "Logistics", segment: "Enterprise" },
  { code: "CL-007", name: "Kigali Fintech Hub", country: "Rwanda", industry: "Financial Services", segment: "SME" },
];

async function main() {
  const deptByCode = new Map<string, string>();
  for (const dept of DEPARTMENTS) {
    const row = await prisma.department.upsert({ where: { code: dept.code }, create: dept, update: dept });
    deptByCode.set(dept.code, row.id);
  }

  const slByCode = new Map<string, string>();
  for (const sl of SERVICE_LINES) {
    const row = await prisma.serviceLine.upsert({ where: { code: sl.code }, create: sl, update: sl });
    slByCode.set(sl.code, row.id);
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
    create: { email: adminEmail, passwordHash, fullName: "System Administrator", officeId: hqOffice.id, isActive: true },
    update: {},
  });

  for (const role of ["system_admin", "ceo"] as const) {
    await prisma.userRole.upsert({
      where: { userId_role: { userId: admin.id, role } },
      create: { userId: admin.id, role },
      update: {},
    });
  }

  // ---------------------------------------------------------------------
  // Demo staff, one lead per department (+ an account manager), so pickers
  // (assignees, tender resources, account managers) aren't empty.
  // ---------------------------------------------------------------------
  const staffPassword = await bcrypt.hash("Amsol2026!", 10);
  const staffByEmail = new Map<string, string>();
  for (const s of STAFF) {
    const user = await prisma.user.upsert({
      where: { email: s.email },
      create: {
        email: s.email,
        passwordHash: staffPassword,
        fullName: s.fullName,
        departmentId: deptByCode.get(s.dept),
        officeId: hqOffice.id,
        isActive: true,
      },
      update: { departmentId: deptByCode.get(s.dept) },
    });
    staffByEmail.set(s.email, user.id);
    await prisma.userRole.upsert({
      where: { userId_role: { userId: user.id, role: s.role } },
      create: { userId: user.id, role: s.role },
      update: {},
    });
  }
  const financeLead = staffByEmail.get("grace.mwangi@amsol.com")!;
  const hrLead = staffByEmail.get("peter.otieno@amsol.com")!;
  const itLead = staffByEmail.get("samuel.kiptoo@amsol.com")!;
  const mktLead = staffByEmail.get("amina.yusuf@amsol.com")!;
  const tenderLead = staffByEmail.get("david.mutua@amsol.com")!;
  const accountManager = staffByEmail.get("linda.achieng@amsol.com")!;

  // ---------------------------------------------------------------------
  // Clients
  // ---------------------------------------------------------------------
  const clientIds: string[] = (await prisma.client.findMany({ select: { id: true } })).map((c) => c.id);
  for (const c of CLIENTS) {
    const row = await prisma.client.upsert({
      where: { code: c.code },
      create: {
        code: c.code,
        name: c.name,
        country: c.country,
        industry: c.industry,
        segment: c.segment,
        accountManagerId: accountManager,
        isActive: true,
      },
      update: {},
    });
    if (!clientIds.includes(row.id)) clientIds.push(row.id);
  }

  // ---------------------------------------------------------------------
  // Contracts — one per new client, spread across departments/service lines/statuses.
  // ---------------------------------------------------------------------
  // endDate is deliberately staggered across "already expired" / "renewal window" / "not yet
  // relevant" / "no end date" so the contract_expiry notification sweep has real variety to
  // demonstrate instead of every active contract being open-ended.
  const contractSeeds = [
    {
      number: "CTR-2026-101",
      title: "Payroll Outsourcing — Savanna Foods",
      clientCode: "CL-004",
      dept: "finance",
      sl: "PAYROLL",
      status: "active" as const,
      billing: "monthly" as const,
      value: 4_800_000,
      endDaysFromNow: 18,
    },
    {
      number: "CTR-2026-102",
      title: "HR Management Retainer — Kampala Traders",
      clientCode: "CL-005",
      dept: "hr",
      sl: "HR_MGMT",
      status: "active" as const,
      billing: "monthly" as const,
      value: 2_400_000,
      endDaysFromNow: 90,
    },
    {
      number: "CTR-2026-103",
      title: "HRMS Licensing — Serengeti Logistics",
      clientCode: "CL-006",
      dept: "it",
      sl: "HRMS",
      status: "active" as const,
      billing: "annual" as const,
      value: 1_600_000,
      endDaysFromNow: -6,
    },
    {
      number: "CTR-2026-104",
      title: "Salary Survey — Kigali Fintech Hub",
      clientCode: "CL-007",
      dept: "marketing_ops",
      sl: "SALARY_SURVEY",
      status: "draft" as const,
      billing: "one_off" as const,
      value: 650_000,
      endDaysFromNow: null,
    },
  ];
  const contractIdByNumber = new Map<string, string>();
  const clientByCode = new Map<string, string>();
  for (const c of CLIENTS) {
    const row = await prisma.client.findUniqueOrThrow({ where: { code: c.code } });
    clientByCode.set(c.code, row.id);
  }
  for (const c of contractSeeds) {
    const endDate = c.endDaysFromNow != null ? daysFromNow(c.endDaysFromNow) : undefined;
    const row = await prisma.contract.upsert({
      where: { contractNumber: c.number },
      create: {
        contractNumber: c.number,
        title: c.title,
        clientId: clientByCode.get(c.clientCode)!,
        departmentId: deptByCode.get(c.dept),
        serviceLineId: slByCode.get(c.sl),
        accountManagerId: accountManager,
        status: c.status,
        billingFrequency: c.billing,
        startDate: monthsAgo(6, 1),
        endDate,
        value: c.value,
        currency: "KES",
        createdBy: admin.id,
      },
      update: { endDate },
    });
    contractIdByNumber.set(c.number, row.id);
  }

  // ---------------------------------------------------------------------
  // Invoices — spread over the last 6 months for a real revenue trend, aging
  // buckets and MoM growth, mixing recurring/one-off and payment states.
  // ---------------------------------------------------------------------
  const invoiceSeeds: {
    number: string;
    monthsAgo: number;
    contract: string;
    clientCode: string;
    sl: string;
    subtotal: number;
    directCost: number;
    recurring: boolean;
    pay: "full" | "partial" | "unpaid" | "overdue" | "draft";
  }[] = [
    { number: "INV-2026-201", monthsAgo: 5, contract: "CTR-2026-101", clientCode: "CL-004", sl: "PAYROLL", subtotal: 400_000, directCost: 180_000, recurring: true, pay: "full" },
    { number: "INV-2026-202", monthsAgo: 5, contract: "CTR-2026-102", clientCode: "CL-005", sl: "HR_MGMT", subtotal: 200_000, directCost: 90_000, recurring: true, pay: "full" },
    { number: "INV-2026-203", monthsAgo: 4, contract: "CTR-2026-101", clientCode: "CL-004", sl: "PAYROLL", subtotal: 400_000, directCost: 175_000, recurring: true, pay: "full" },
    { number: "INV-2026-204", monthsAgo: 4, contract: "CTR-2026-102", clientCode: "CL-005", sl: "HR_MGMT", subtotal: 200_000, directCost: 88_000, recurring: true, pay: "full" },
    { number: "INV-2026-205", monthsAgo: 4, contract: "CTR-2026-103", clientCode: "CL-006", sl: "HRMS", subtotal: 1_600_000, directCost: 520_000, recurring: true, pay: "full" },
    { number: "INV-2026-206", monthsAgo: 3, contract: "CTR-2026-101", clientCode: "CL-004", sl: "PAYROLL", subtotal: 400_000, directCost: 170_000, recurring: true, pay: "full" },
    { number: "INV-2026-207", monthsAgo: 3, contract: "CTR-2026-102", clientCode: "CL-005", sl: "HR_MGMT", subtotal: 210_000, directCost: 92_000, recurring: true, pay: "full" },
    { number: "INV-2026-208", monthsAgo: 3, contract: undefined as unknown as string, clientCode: "CL-004", sl: "RECRUITMENT", subtotal: 350_000, directCost: 140_000, recurring: false, pay: "full" },
    { number: "INV-2026-209", monthsAgo: 2, contract: "CTR-2026-101", clientCode: "CL-004", sl: "PAYROLL", subtotal: 420_000, directCost: 182_000, recurring: true, pay: "partial" },
    { number: "INV-2026-210", monthsAgo: 2, contract: "CTR-2026-102", clientCode: "CL-005", sl: "HR_MGMT", subtotal: 210_000, directCost: 91_000, recurring: true, pay: "full" },
    { number: "INV-2026-211", monthsAgo: 2, contract: undefined as unknown as string, clientCode: "CL-006", sl: "TRAINING", subtotal: 280_000, directCost: 95_000, recurring: false, pay: "full" },
    { number: "INV-2026-212", monthsAgo: 1, contract: "CTR-2026-101", clientCode: "CL-004", sl: "PAYROLL", subtotal: 420_000, directCost: 178_000, recurring: true, pay: "partial" },
    { number: "INV-2026-213", monthsAgo: 1, contract: "CTR-2026-102", clientCode: "CL-005", sl: "HR_MGMT", subtotal: 215_000, directCost: 93_000, recurring: true, pay: "full" },
    { number: "INV-2026-214", monthsAgo: 1, contract: undefined as unknown as string, clientCode: "CL-007", sl: "ADVISORY", subtotal: 180_000, directCost: 70_000, recurring: false, pay: "overdue" },
    { number: "INV-2026-215", monthsAgo: 0, contract: "CTR-2026-101", clientCode: "CL-004", sl: "PAYROLL", subtotal: 430_000, directCost: 180_000, recurring: true, pay: "unpaid" },
    { number: "INV-2026-216", monthsAgo: 0, contract: "CTR-2026-102", clientCode: "CL-005", sl: "HR_MGMT", subtotal: 215_000, directCost: 92_000, recurring: true, pay: "unpaid" },
    { number: "INV-2026-217", monthsAgo: 0, contract: undefined as unknown as string, clientCode: "CL-006", sl: "RECRUITMENT", subtotal: 300_000, directCost: 120_000, recurring: false, pay: "overdue" },
    { number: "INV-2026-218", monthsAgo: 0, contract: "CTR-2026-104", clientCode: "CL-007", sl: "SALARY_SURVEY", subtotal: 650_000, directCost: 260_000, recurring: false, pay: "draft" },
  ];

  for (const inv of invoiceSeeds) {
    const tax = Math.round(inv.subtotal * 0.16);
    const total = inv.subtotal + tax;
    const issueDate = monthsAgo(inv.monthsAgo, 5);
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + (inv.pay === "overdue" ? 14 : 30));
    const status = inv.pay === "draft" ? "draft" : "sent";

    const row = await prisma.invoice.upsert({
      where: { invoiceNumber: inv.number },
      create: {
        invoiceNumber: inv.number,
        clientId: clientByCode.get(inv.clientCode)!,
        serviceLineId: slByCode.get(inv.sl),
        contractId: inv.contract ? contractIdByNumber.get(inv.contract) : undefined,
        issueDate,
        dueDate,
        subtotal: inv.subtotal,
        tax,
        total,
        directCost: inv.directCost,
        status,
        isRecurring: inv.recurring,
        createdBy: financeLead,
      },
      update: {},
    });

    const existingPayments = await prisma.invoicePayment.count({ where: { invoiceId: row.id } });
    if (existingPayments === 0) {
      if (inv.pay === "full") {
        await prisma.invoicePayment.create({
          data: { invoiceId: row.id, amount: total, paidOn: dueDate, method: "bank_transfer" },
        });
        await prisma.invoice.update({ where: { id: row.id }, data: { status: "paid" } });
      } else if (inv.pay === "partial") {
        const partial = Math.round(total * 0.5);
        await prisma.invoicePayment.create({
          data: { invoiceId: row.id, amount: partial, paidOn: issueDate, method: "mpesa" },
        });
        await prisma.invoice.update({ where: { id: row.id }, data: { status: "partial" } });
      }
    }
  }

  // ---------------------------------------------------------------------
  // Projects + tasks — one project per department with varied, real
  // completion rates so "Completion by department" reflects genuine data.
  // ---------------------------------------------------------------------
  // Task tuples: [title, status, phase, estimatedHours, actualHours]. actualHours on a task
  // still in "not_started" is deliberately 0 — matches the prototype's own convention that
  // hours only accrue once work has actually begun.
  const projectSeeds = [
    {
      name: "Payroll Platform Migration",
      dept: "finance",
      lead: financeLead,
      clientCode: "CL-004",
      status: "active" as const,
      deliveryStage: "payment" as const,
      methodology: "Waterfall + Hypercare",
      health: "green" as const,
      budget: 3_800_000,
      endDaysFromNow: 10,
      tasks: [
        ["Data migration plan", "completed", "Mobilization & Planning", 24, 26],
        ["Legacy payroll export", "completed", "Mobilization & Planning", 16, 15],
        ["New platform config", "completed", "Migration & Configuration", 40, 44],
        ["UAT sign-off", "completed", "Migration & Configuration", 12, 10],
        ["Parallel run — month 1", "completed", "Testing & Training", 20, 22],
        ["Parallel run — month 2", "completed", "Testing & Training", 20, 18],
        ["Staff training", "completed", "Testing & Training", 16, 16],
        ["Go-live checklist", "completed", "Go-Live & Support", 8, 8],
        ["Hypercare support", "in_progress", "Go-Live & Support", 16, 9],
        ["Post go-live review", "not_started", "Go-Live & Support", 8, 0],
      ] as [string, string, string, number, number][],
    },
    {
      name: "HR Policy Handbook Refresh",
      dept: "hr",
      lead: hrLead,
      clientCode: "CL-005",
      status: "active" as const,
      deliveryStage: "delivery" as const,
      methodology: "Agile (2-week sprints)",
      health: "amber" as const,
      budget: 1_450_000,
      endDaysFromNow: 20,
      tasks: [
        ["Policy gap analysis", "completed", "Discovery", 12, 14],
        ["Draft leave policy", "completed", "Drafting", 16, 18],
        ["Draft disciplinary policy", "completed", "Drafting", 16, 15],
        ["Legal review", "completed", "Drafting", 10, 12],
        ["Draft remote work policy", "completed", "Drafting", 14, 13],
        ["Stakeholder workshop", "in_progress", "Review & Rollout", 8, 5],
        ["Manager briefing pack", "in_progress", "Review & Rollout", 10, 4],
        ["Employee rollout", "blocked", "Review & Rollout", 12, 0],
        ["Final sign-off", "not_started", "Review & Rollout", 4, 0],
      ] as [string, string, string, number, number][],
    },
    {
      name: "HRMS Cloud Infrastructure Upgrade",
      dept: "it",
      lead: itLead,
      clientCode: "CL-006",
      status: "active" as const,
      deliveryStage: "in_progress" as const,
      methodology: "Agile (2-week sprints)",
      health: "amber" as const,
      budget: 2_600_000,
      endDaysFromNow: 35,
      tasks: [
        ["Infra audit", "completed", "Assessment", 20, 22],
        ["Environment provisioning", "completed", "Build", 24, 26],
        ["Database migration", "completed", "Build", 32, 35],
        ["Security hardening", "in_progress", "Build", 20, 14],
        ["Load testing", "in_progress", "Testing", 16, 8],
        ["Backup/DR setup", "blocked", "Testing", 12, 0],
        ["Monitoring & alerting", "blocked", "Testing", 10, 0],
        ["Cutover plan", "not_started", "Cutover", 8, 0],
      ] as [string, string, string, number, number][],
    },
    {
      name: "Brand Refresh Campaign",
      dept: "marketing_ops",
      lead: mktLead,
      clientCode: null,
      status: "active" as const,
      deliveryStage: "closed" as const,
      methodology: "Kanban",
      health: "green" as const,
      budget: 950_000,
      endDaysFromNow: -5,
      tasks: [
        ["Brand audit", "completed", "Discovery", 10, 10],
        ["New logo suite", "completed", "Creative", 20, 19],
        ["Website copy refresh", "completed", "Creative", 14, 15],
        ["Social templates", "completed", "Creative", 8, 8],
        ["Client case studies", "completed", "Creative", 12, 11],
        ["Launch campaign assets", "completed", "Launch", 16, 17],
        ["Press release", "completed", "Launch", 4, 4],
        ["Internal launch event", "completed", "Launch", 6, 6],
        ["Post-launch survey", "completed", "Wrap-up", 4, 3],
        ["Retrospective", "in_progress", "Wrap-up", 3, 2],
      ] as [string, string, string, number, number][],
    },
    {
      name: "Tender Response Playbook",
      dept: "tender",
      lead: tenderLead,
      clientCode: null,
      status: "active" as const,
      deliveryStage: "onboarding" as const,
      methodology: "Waterfall",
      health: "green" as const,
      budget: 600_000,
      endDaysFromNow: 25,
      tasks: [
        ["Template library", "completed", "Foundations", 12, 13],
        ["Pricing model standardisation", "completed", "Foundations", 10, 9],
        ["Win/loss archive review", "completed", "Foundations", 8, 8],
        ["Proposal review checklist", "completed", "Foundations", 6, 6],
        ["Bid/no-bid framework", "in_progress", "Rollout", 8, 4],
        ["Reviewer training", "in_progress", "Rollout", 10, 3],
        ["Compliance matrix template", "in_progress", "Rollout", 6, 2],
        ["Playbook publish", "blocked", "Rollout", 4, 0],
        ["Team rollout", "not_started", "Rollout", 6, 0],
      ] as [string, string, string, number, number][],
    },
  ];

  const projectTaskIds = new Map<string, string[]>(); // project name -> ordered task ids, for dependency wiring below
  for (const p of projectSeeds) {
    let project = await prisma.project.findFirst({ where: { name: p.name } });
    if (!project) {
      project = await prisma.project.create({
        data: {
          name: p.name,
          departmentId: deptByCode.get(p.dept)!,
          clientId: p.clientCode ? clientByCode.get(p.clientCode) : undefined,
          status: p.status,
          deliveryStage: p.deliveryStage,
          methodology: p.methodology,
          health: p.health,
          budget: p.budget,
          startDate: monthsAgo(4, 1),
          endDate: daysFromNow(p.endDaysFromNow),
          createdBy: admin.id,
        },
      });
    } else if (
      project.deliveryStage !== p.deliveryStage ||
      project.methodology !== p.methodology ||
      project.health !== p.health ||
      Number(project.budget ?? 0) !== p.budget ||
      !project.endDate
    ) {
      project = await prisma.project.update({
        where: { id: project.id },
        data: {
          deliveryStage: p.deliveryStage,
          methodology: p.methodology,
          health: p.health,
          budget: p.budget,
          endDate: daysFromNow(p.endDaysFromNow),
        },
      });
    }
    // Spread every task across the project's own start/end window, proportional to cumulative
    // estimated hours, so ALL tasks (not just a couple of open ones) get a real start/due date —
    // the Gantt chart and Calendar tab need this to have something to actually plot.
    const projectStart = project.startDate ?? monthsAgo(4, 1);
    const projectEnd = project.endDate ?? daysFromNow(p.endDaysFromNow);
    const totalHours = p.tasks.reduce((a, t) => a + t[3], 0) || p.tasks.length;
    let cursorHours = 0;
    const taskDates = p.tasks.map(([, , , estimatedHours]) => {
      const fracStart = cursorHours / totalHours;
      cursorHours += estimatedHours;
      const fracEnd = cursorHours / totalHours;
      return {
        startDate: dateAtFraction(projectStart, projectEnd, fracStart),
        dueDate: dateAtFraction(projectStart, projectEnd, fracEnd),
      };
    });

    const existingTasks = await prisma.task.findMany({
      where: { projectId: project.id },
      orderBy: { position: "asc" },
      select: { id: true, position: true, startDate: true, dueDate: true, phase: true },
    });
    if (existingTasks.length === 0) {
      let position = 0;
      const createdIds: string[] = [];
      for (const [title, status, phase, estimatedHours, actualHours] of p.tasks) {
        const { startDate, dueDate } = taskDates[position];
        const task = await prisma.task.create({
          data: {
            projectId: project.id,
            title,
            status: status as "not_started" | "in_progress" | "review" | "blocked" | "completed",
            priority: "medium",
            assigneeId: p.lead,
            startDate,
            dueDate,
            phase,
            estimatedHours,
            actualHours,
            position: position++,
            createdBy: admin.id,
          },
        });
        createdIds.push(task.id);
      }
      projectTaskIds.set(p.name, createdIds);
    } else {
      // Sync dates/phase/hours to the computed targets on reseed, same pattern used elsewhere in
      // this file for tender/client-request stage sync — keeps a repeat `prisma db seed` run
      // convergent regardless of what an earlier version of this script already wrote.
      for (const t of existingTasks) {
        const seedTask = p.tasks[t.position];
        const dates = taskDates[t.position];
        if (!seedTask || !dates) continue;
        const [, , phase, estimatedHours, actualHours] = seedTask;
        const currentStart = t.startDate ? t.startDate.toISOString().slice(0, 10) : null;
        const currentDue = t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null;
        if (
          currentStart !== dates.startDate.toISOString().slice(0, 10) ||
          currentDue !== dates.dueDate.toISOString().slice(0, 10) ||
          t.phase !== phase
        ) {
          await prisma.task.update({
            where: { id: t.id },
            data: { startDate: dates.startDate, dueDate: dates.dueDate, phase, estimatedHours, actualHours },
          });
        }
      }
      projectTaskIds.set(p.name, existingTasks.map((t) => t.id));
    }
  }

  // Sequential in-phase dependencies on the flagship project — enough to make the Gantt's
  // dependency lines and the Tasks tab's "blocked by" chips non-trivial without wiring every
  // task to every other task.
  const payrollTaskIds = projectTaskIds.get("Payroll Platform Migration");
  if (payrollTaskIds && payrollTaskIds.length >= 10) {
    const deps: [number, number][] = [
      [1, 0], // Legacy payroll export depends on Data migration plan
      [2, 1], // New platform config depends on Legacy payroll export
      [3, 2], // UAT sign-off depends on New platform config
      [4, 3], // Parallel run month 1 depends on UAT sign-off
      [5, 4], // Parallel run month 2 depends on Parallel run month 1
      [6, 5], // Staff training depends on Parallel run month 2
      [7, 6], // Go-live checklist depends on Staff training
      [8, 7], // Hypercare support depends on Go-live checklist
      [9, 8], // Post go-live review depends on Hypercare support
    ];
    for (const [taskIdx, dependsOnIdx] of deps) {
      await prisma.taskDependency.upsert({
        where: {
          taskId_dependsOnId: {
            taskId: payrollTaskIds[taskIdx],
            dependsOnId: payrollTaskIds[dependsOnIdx],
          },
        },
        update: {},
        create: { taskId: payrollTaskIds[taskIdx], dependsOnId: payrollTaskIds[dependsOnIdx] },
      });
    }
  }

  // ---------------------------------------------------------------------
  // Project workspace detail — cost items, team roster (incl. one external
  // member), RACI matrix, and RAID log on the flagship project so the new
  // workspace tabs have real, presentable data on first load.
  // ---------------------------------------------------------------------
  const payrollProject = await prisma.project.findFirst({ where: { name: "Payroll Platform Migration" } });
  if (payrollProject) {
    const costItemSeeds = [
      { category: "Internal Labour", budgetedAmount: 1_800_000, actualAmount: 1_650_000 },
      { category: "Platform Licensing", budgetedAmount: 900_000, actualAmount: 900_000 },
      { category: "Data Migration Tooling", budgetedAmount: 350_000, actualAmount: 410_000 },
      { category: "Training & Change Mgmt", budgetedAmount: 250_000, actualAmount: 180_000 },
      { category: "Contingency", budgetedAmount: 500_000, actualAmount: 60_000 },
    ];
    const existingCostItems = await prisma.projectCostItem.count({ where: { projectId: payrollProject.id } });
    if (existingCostItems === 0) {
      for (const c of costItemSeeds) {
        await prisma.projectCostItem.create({
          data: { projectId: payrollProject.id, ...c, createdBy: admin.id },
        });
      }
    }

    const teamSeeds = [
      { userId: financeLead, name: "Grace Mwangi", role: "Project Lead", type: "internal" as const, allocationPercent: 80, hoursLogged: 240 },
      { userId: undefined, name: "Linda Achieng", role: "Finance Analyst", type: "internal" as const, allocationPercent: 50, hoursLogged: 140 },
      { userId: undefined, name: "Samuel Kiptoo", role: "Systems Integration", type: "internal" as const, allocationPercent: 30, hoursLogged: 90 },
      { userId: undefined, name: "Wanjiru Kamau", role: "Payroll Platform Consultant (Vendor)", type: "external" as const, allocationPercent: 60, hoursLogged: 160 },
    ];
    const existingTeam = await prisma.projectTeamMember.count({ where: { projectId: payrollProject.id } });
    if (existingTeam === 0) {
      for (const t of teamSeeds) {
        await prisma.projectTeamMember.create({
          data: { projectId: payrollProject.id, ...t },
        });
      }
    }

    const raciSeeds = [
      { deliverable: "Migration plan & timeline", responsible: "Grace Mwangi", accountable: "Grace Mwangi", consulted: "Samuel Kiptoo", informed: "Finance Leadership", sortOrder: 0 },
      { deliverable: "Platform configuration", responsible: "Wanjiru Kamau (Vendor)", accountable: "Grace Mwangi", consulted: "Samuel Kiptoo", informed: "HR Leadership", sortOrder: 1 },
      { deliverable: "UAT & sign-off", responsible: "Linda Achieng", accountable: "Grace Mwangi", consulted: "Payroll Team", informed: "CEO", sortOrder: 2 },
      { deliverable: "Go-live cutover", responsible: "Samuel Kiptoo", accountable: "Grace Mwangi", consulted: "Wanjiru Kamau (Vendor)", informed: "All Staff", sortOrder: 3 },
    ];
    const existingRaci = await prisma.projectRaciEntry.count({ where: { projectId: payrollProject.id } });
    if (existingRaci === 0) {
      for (const r of raciSeeds) {
        await prisma.projectRaciEntry.create({ data: { projectId: payrollProject.id, ...r } });
      }
    }

    const raidSeeds = [
      {
        type: "risk" as const,
        description: "Legacy payroll exports contain inconsistent employee ID formats across subsidiaries.",
        severity: "high" as const,
        owner: "Grace Mwangi",
        status: "open" as const,
        mitigation: "Running a normalization pass before final import; spot-checking 10% sample per subsidiary.",
      },
      {
        type: "issue" as const,
        description: "Vendor consultant availability reduced during hypercare window due to another engagement.",
        severity: "medium" as const,
        owner: "Wanjiru Kamau",
        status: "open" as const,
        mitigation: "Escalated to vendor account manager; backup consultant on standby.",
      },
      {
        type: "dependency" as const,
        description: "Go-live cutover depends on IT completing infrastructure sign-off for the new payroll environment.",
        severity: "medium" as const,
        owner: "Samuel Kiptoo",
        status: "accepted" as const,
        mitigation: null,
      },
      {
        type: "assumption" as const,
        description: "Assumes no further statutory payroll regulation changes before go-live.",
        severity: "low" as const,
        owner: "Grace Mwangi",
        status: "closed" as const,
        mitigation: null,
      },
    ];
    const existingRaid = await prisma.projectRaidEntry.count({ where: { projectId: payrollProject.id } });
    if (existingRaid === 0) {
      for (const r of raidSeeds) {
        await prisma.projectRaidEntry.create({ data: { projectId: payrollProject.id, ...r, createdBy: admin.id } });
      }
    }
  }

  // ---------------------------------------------------------------------
  // Tenders — one per pipeline stage, spread across departments, so the
  // funnel and win-rate on both the Tender module and CEO dashboard have
  // real variety instead of a single row.
  // ---------------------------------------------------------------------
  const tenderSeeds = [
    {
      ref: "TND-2026-001",
      title: "Government Payroll Modernization",
      dept: "tender",
      sl: "PAYROLL",
      clientCode: null,
      prospectClientName: "Coastal Retail Group",
      stage: "identified" as const,
      value: 2_000_000,
      deadline: daysFromNow(45),
    },
    {
      ref: "TND-2026-002",
      title: "County HR Systems Rollout",
      dept: "tender",
      sl: "HRMS",
      clientCode: null,
      stage: "applying" as const,
      value: 3_500_000,
      deadline: daysFromNow(20),
      withResourcing: true,
    },
    {
      ref: "TND-2026-003",
      title: "Bank Sector Recruitment Drive",
      dept: "hr",
      sl: "RECRUITMENT",
      clientCode: null,
      stage: "submitted" as const,
      value: 1_200_000,
      deadline: daysFromNow(10),
      withResourcing: true,
    },
    {
      ref: "TND-2026-004",
      title: "NGO Regional Salary Survey",
      dept: "hr",
      sl: "SALARY_SURVEY",
      clientCode: null,
      stage: "evaluation" as const,
      value: 450_000,
      deadline: daysFromNow(5),
    },
    {
      ref: "TND-2026-005",
      title: "Telco Staff Training Program",
      dept: "marketing_ops",
      sl: "TRAINING",
      clientCode: "CL-006",
      stage: "won" as const,
      value: 1_800_000,
      deadline: daysFromNow(-10),
      convertToContract: true,
    },
    {
      ref: "TND-2026-006",
      title: "Manufacturing Payroll Outsourcing Bid",
      dept: "finance",
      sl: "PAYROLL",
      clientCode: null,
      stage: "lost" as const,
      value: 900_000,
      deadline: daysFromNow(-20),
      lostReason: "Lost on price to a lower-cost competitor.",
    },
    {
      ref: "TND-2026-007",
      title: "Retail HRMS Licensing Bid",
      dept: "it",
      sl: "HRMS",
      clientCode: null,
      stage: "withdrawn" as const,
      value: 600_000,
      deadline: daysFromNow(-5),
    },
  ];

  // Staggered relative to each seed's own deadline (already spread via daysFromNow) rather
  // than a single "now" for every timestamp — otherwise createdAt/submittedAt/wonAt/lostAt
  // all land within the same second and every tender reports ~0 days to submit/decide on the
  // time-metrics endpoint, which is technically correct but not a useful demo of the feature.
  const TENDER_TIMING: Record<TenderStage, { createdDaysAgo: number; submittedDaysAgo?: number; decidedDaysAgo?: number }> = {
    identified: { createdDaysAgo: 5 },
    applying: { createdDaysAgo: 14 },
    submitted: { createdDaysAgo: 22, submittedDaysAgo: 4 },
    evaluation: { createdDaysAgo: 28, submittedDaysAgo: 12 },
    won: { createdDaysAgo: 35, submittedDaysAgo: 16, decidedDaysAgo: 10 },
    lost: { createdDaysAgo: 32, submittedDaysAgo: 24, decidedDaysAgo: 20 },
    withdrawn: { createdDaysAgo: 15 },
  };

  for (const t of tenderSeeds) {
    let tender = await prisma.tender.findFirst({ where: { referenceNumber: t.ref } });
    if (!tender) {
      const timing = TENDER_TIMING[t.stage];
      tender = await prisma.tender.create({
        data: {
          referenceNumber: t.ref,
          title: t.title,
          departmentId: deptByCode.get(t.dept)!,
          serviceLineId: slByCode.get(t.sl),
          clientId: t.clientCode ? clientByCode.get(t.clientCode) : undefined,
          prospectClientName: "prospectClientName" in t ? t.prospectClientName : undefined,
          accountManagerId: accountManager,
          stage: t.stage,
          estimatedValue: t.value,
          submissionDeadline: t.deadline,
          createdAt: daysFromNow(-timing.createdDaysAgo),
          submittedAt: timing.submittedDaysAgo != null ? daysFromNow(-timing.submittedDaysAgo) : undefined,
          wonAt: t.stage === "won" && timing.decidedDaysAgo != null ? daysFromNow(-timing.decidedDaysAgo) : undefined,
          lostAt: t.stage === "lost" && timing.decidedDaysAgo != null ? daysFromNow(-timing.decidedDaysAgo) : undefined,
          lostReason: t.lostReason,
          createdBy: tenderLead,
        },
      });
    } else {
      // Re-running the seed against a DB where these already exist from an older seed.ts
      // (pre-staggered timing) shouldn't leave them stuck on stale identical timestamps.
      const timing = TENDER_TIMING[t.stage];
      tender = await prisma.tender.update({
        where: { id: tender.id },
        data: {
          stage: t.stage,
          lostReason: t.lostReason,
          createdAt: daysFromNow(-timing.createdDaysAgo),
          submittedAt: timing.submittedDaysAgo != null ? daysFromNow(-timing.submittedDaysAgo) : null,
          wonAt: t.stage === "won" && timing.decidedDaysAgo != null ? daysFromNow(-timing.decidedDaysAgo) : null,
          lostAt: t.stage === "lost" && timing.decidedDaysAgo != null ? daysFromNow(-timing.decidedDaysAgo) : null,
        },
      });
    }

    if (t.withResourcing) {
      const existingResource = await prisma.tenderResource.findFirst({
        where: { tenderId: tender.id, userId: tenderLead },
      });
      if (!existingResource) {
        await prisma.tenderResource.create({
          data: { tenderId: tender.id, userId: tenderLead, allocatedHours: 40, hourlyRate: 2500, roleNote: "Bid lead" },
        });
        await prisma.tenderTimeEntry.create({
          data: { tenderId: tender.id, userId: tenderLead, entryDate: daysFromNow(-3), hours: 6, notes: "Proposal drafting", createdBy: tenderLead },
        });
        await prisma.tenderTimeEntry.create({
          data: { tenderId: tender.id, userId: tenderLead, entryDate: daysFromNow(-1), hours: 4, notes: "Pricing review", createdBy: tenderLead },
        });
      }
    }

    if (t.convertToContract) {
      let contract = await prisma.contract.findFirst({ where: { tenderId: tender.id } });
      if (!contract) {
        contract = await prisma.contract.create({
          data: {
            contractNumber: "CTR-2026-105",
            title: t.title,
            clientId: clientByCode.get(t.clientCode!)!,
            departmentId: deptByCode.get(t.dept)!,
            serviceLineId: slByCode.get(t.sl),
            accountManagerId: accountManager,
            tenderId: tender.id,
            status: "active",
            billingFrequency: "one_off",
            startDate: daysFromNow(-5),
            value: t.value,
            currency: "KES",
            createdBy: admin.id,
          },
        });
      }

      // "Forward to Department" — a won tender also becomes a live delivery project (not
      // just a contract), so the Projects & Delivery board has a Tender-sourced card too.
      const existingTenderProject = await prisma.project.findFirst({ where: { tenderId: tender.id } });
      if (!existingTenderProject) {
        await prisma.project.create({
          data: {
            name: t.title,
            clientId: clientByCode.get(t.clientCode!)!,
            contractId: contract.id,
            tenderId: tender.id,
            departmentId: deptByCode.get(t.dept)!,
            status: "active",
            deliveryStage: "delivery",
            startDate: daysFromNow(-5),
            createdBy: admin.id,
          },
        });
      }
    }
  }

  // ---------------------------------------------------------------------
  // Advanced tender management demo data — a reusable requirement template
  // applied to one tender, plus financial resourcing (cost items, a bond,
  // pricing breakdown) on the same tender, so the new Financials and
  // Requirements tabs have something real to show immediately.
  // ---------------------------------------------------------------------
  let template = await prisma.tenderRequirementTemplate.findFirst({
    where: { name: "Government tender standard requirements" },
  });
  if (!template) {
    template = await prisma.tenderRequirementTemplate.create({
      data: {
        name: "Government tender standard requirements",
        description: "Standard checklist for public-sector bids.",
        createdBy: tenderLead,
        items: {
          create: [
            { title: "Tax compliance certificate", category: "legal", sortOrder: 0 },
            { title: "Certificate of incorporation", category: "legal", sortOrder: 1 },
            { title: "Company profile", category: "technical", sortOrder: 2 },
            { title: "3 years audited accounts", category: "financial", sortOrder: 3 },
            { title: "Bank reference letter", category: "financial", sortOrder: 4 },
            { title: "Bid security / bond", category: "financial", sortOrder: 5 },
          ],
        },
      },
    });
  }

  const rolloutTender = await prisma.tender.findFirst({ where: { referenceNumber: "TND-2026-002" } });
  if (rolloutTender) {
    const existingRequirements = await prisma.tenderRequirement.count({ where: { tenderId: rolloutTender.id } });
    if (existingRequirements === 0) {
      const templateItems = await prisma.tenderRequirementTemplateItem.findMany({
        where: { templateId: template.id },
        orderBy: { sortOrder: "asc" },
      });
      await prisma.tenderRequirement.createMany({
        data: templateItems.map((item, i) => ({
          tenderId: rolloutTender.id,
          title: item.title,
          category: item.category,
          sortOrder: i,
          status: i < 2 ? "obtained" : i < 4 ? "in_progress" : "pending",
        })),
      });
    }

    const existingCostItems = await prisma.tenderCostItem.count({ where: { tenderId: rolloutTender.id } });
    if (existingCostItems === 0) {
      await prisma.tenderCostItem.createMany({
        data: [
          { tenderId: rolloutTender.id, category: "travel", description: "Site visits to county offices", amount: 45_000, createdBy: tenderLead },
          { tenderId: rolloutTender.id, category: "printing", description: "Proposal printing & binding", amount: 8_500, createdBy: tenderLead },
          { tenderId: rolloutTender.id, category: "consultant", description: "External HRMS technical advisor", amount: 120_000, createdBy: tenderLead },
        ],
      });
    }

    const existingBonds = await prisma.tenderBond.count({ where: { tenderId: rolloutTender.id } });
    if (existingBonds === 0) {
      await prisma.tenderBond.create({
        data: {
          tenderId: rolloutTender.id,
          bondType: "bid_bond",
          amount: 175_000,
          provider: "Equity Bank",
          status: "lodged",
          issuedDate: daysFromNow(-10),
          expiryDate: daysFromNow(80),
        },
      });
    }

    const existingPricing = await prisma.tenderPricingItem.count({ where: { tenderId: rolloutTender.id } });
    if (existingPricing === 0) {
      await prisma.tenderPricingItem.createMany({
        data: [
          { tenderId: rolloutTender.id, sortOrder: 0, description: "HRMS licensing (3-year term)", quantity: 1, unitPrice: 2_400_000 },
          { tenderId: rolloutTender.id, sortOrder: 1, description: "Implementation & data migration", quantity: 1, unitPrice: 650_000 },
          { tenderId: rolloutTender.id, sortOrder: 2, description: "Staff training (per county office)", quantity: 5, unitPrice: 90_000 },
        ],
      });
    }
  }

  // ---------------------------------------------------------------------
  // Client Requests — the lead-intake pipeline (Operations/Marketing → routed
  // department → engaged → converted/lost/withdrawn), spread across every
  // stage so the module's own funnel and the CEO dashboard's "Client Request
  // Pipeline" + "Where requests fail" widgets have real variety.
  // ---------------------------------------------------------------------
  const clientRequestSeeds = [
    {
      ref: "CRQ-2026-001",
      title: "Payroll setup enquiry — new FMCG entrant",
      description: "Inbound website enquiry about outsourced payroll for a new Kenyan subsidiary.",
      prospectClientName: "Nyeri Textiles Ltd",
      source: "website" as const,
      sl: "PAYROLL",
      stage: "new" as const,
      value: 900_000,
    },
    {
      ref: "CRQ-2026-002",
      title: "Refresher training request",
      clientCode: "CL-004",
      source: "referral" as const,
      sl: "TRAINING",
      stage: "new" as const,
      value: 250_000,
    },
    {
      ref: "CRQ-2026-003",
      title: "HR management retainer expansion",
      clientCode: "CL-005",
      source: "operations" as const,
      sl: "HR_MGMT",
      dept: "finance",
      assignedTo: financeLead,
      stage: "assigned" as const,
      value: 1_100_000,
    },
    {
      ref: "CRQ-2026-004",
      title: "HRMS licensing enquiry — logistics group",
      prospectClientName: "Uganda Freight Systems",
      contactName: "Ronald Ssemwogerere",
      contactEmail: "ronald@ugfreight.example.com",
      source: "marketing" as const,
      sl: "HRMS",
      dept: "it",
      assignedTo: itLead,
      stage: "assigned" as const,
      value: 1_400_000,
    },
    {
      ref: "CRQ-2026-005",
      title: "Recruitment drive — agribusiness expansion",
      prospectClientName: "Rift Valley Agrotech",
      contactName: "Esther Chebet",
      contactEmail: "esther@riftvalleyagro.example.com",
      source: "marketing" as const,
      sl: "RECRUITMENT",
      dept: "hr",
      assignedTo: hrLead,
      stage: "engaging" as const,
      value: 700_000,
      activities: [
        { type: "call" as const, summary: "Introductory call — scoped roles and headcount target.", daysAgo: 6 },
        { type: "meeting" as const, summary: "Site visit to discuss recruitment timeline and budget.", daysAgo: 2 },
      ],
    },
    {
      ref: "CRQ-2026-006",
      title: "Salary survey — regional expansion planning",
      clientCode: "CL-006",
      source: "operations" as const,
      sl: "SALARY_SURVEY",
      dept: "marketing_ops",
      assignedTo: mktLead,
      stage: "proposal" as const,
      value: 380_000,
      activities: [
        { type: "email" as const, summary: "Sent scope and timeline proposal.", daysAgo: 4 },
        { type: "note" as const, summary: "Client reviewing internally, follow up next week.", daysAgo: 1 },
      ],
    },
    {
      ref: "CRQ-2026-007",
      title: "One-off recruitment support — fintech scale-up",
      clientCode: "CL-007",
      source: "operations" as const,
      sl: "RECRUITMENT",
      dept: "hr",
      assignedTo: hrLead,
      stage: "won" as const,
      value: 500_000,
      convertToProject: { name: "Kigali Fintech Hub — Recruitment Support" },
    },
    {
      ref: "CRQ-2026-008",
      title: "Payroll outsourcing — additional business unit",
      clientCode: "CL-004",
      source: "referral" as const,
      sl: "PAYROLL",
      dept: "finance",
      assignedTo: financeLead,
      stage: "won" as const,
      value: 3_200_000,
      convertToContract: { number: "CTR-2026-106", billing: "monthly" as const },
    },
    {
      ref: "CRQ-2026-009",
      title: "HRMS licensing bid enquiry — freight sector",
      prospectClientName: "Coastal Freight Co",
      source: "website" as const,
      sl: "HRMS",
      dept: "it",
      assignedTo: itLead,
      stage: "lost" as const,
      lostFromStage: "engaging" as const,
      lostReason: "Client selected an in-house HRMS build instead.",
      value: 950_000,
    },
    {
      ref: "CRQ-2026-010",
      title: "Advisory retainer enquiry",
      clientCode: "CL-006",
      source: "operations" as const,
      sl: "ADVISORY",
      dept: "marketing_ops",
      assignedTo: mktLead,
      stage: "withdrawn" as const,
      lostFromStage: "assigned" as const,
      lostReason: "Client paused the initiative for this fiscal year.",
      value: 300_000,
    },
  ];

  for (const r of clientRequestSeeds) {
    let request = await prisma.clientRequest.findFirst({ where: { referenceNumber: r.ref } });
    const routed = "dept" in r && !!r.dept;
    const engagingOrLater =
      r.stage === "engaging" || r.stage === "proposal" || r.stage === "won" || r.stage === "lost" || r.stage === "withdrawn";
    const proposalOrLater = r.stage === "proposal" || r.stage === "won";
    const resolvedLostFromStage = "lostFromStage" in r ? r.lostFromStage : undefined;
    if (!request) {
      request = await prisma.clientRequest.create({
        data: {
          referenceNumber: r.ref,
          title: r.title,
          description: "description" in r ? r.description : undefined,
          clientId: r.clientCode ? clientByCode.get(r.clientCode) : undefined,
          prospectClientName: "prospectClientName" in r ? r.prospectClientName : undefined,
          contactName: "contactName" in r ? r.contactName : undefined,
          contactEmail: "contactEmail" in r ? r.contactEmail : undefined,
          source: r.source,
          serviceLineId: slByCode.get(r.sl),
          departmentId: "dept" in r && r.dept ? deptByCode.get(r.dept) : undefined,
          assignedToId: "assignedTo" in r ? r.assignedTo : undefined,
          stage: r.stage,
          estimatedValue: r.value,
          routedAt: routed ? daysFromNow(-12) : undefined,
          engagedAt: engagingOrLater ? daysFromNow(-8) : undefined,
          proposalSentAt: proposalOrLater ? daysFromNow(-5) : undefined,
          convertedAt: r.stage === "won" ? daysFromNow(-2) : undefined,
          lostAt: r.stage === "lost" || r.stage === "withdrawn" ? daysFromNow(-1) : undefined,
          lostFromStage: resolvedLostFromStage,
          lostReason: "lostReason" in r ? r.lostReason : undefined,
          createdBy: mktLead,
          createdAt: daysFromNow(-14),
        },
      });
    } else if (request.stage !== r.stage) {
      // Keep an already-seeded request's stage in sync with this script's intent (e.g. a
      // stage this seed array was edited to move to a newly-added stage like "proposal").
      request = await prisma.clientRequest.update({
        where: { id: request.id },
        data: {
          stage: r.stage,
          routedAt: routed ? (request.routedAt ?? daysFromNow(-12)) : request.routedAt,
          engagedAt: engagingOrLater ? (request.engagedAt ?? daysFromNow(-8)) : request.engagedAt,
          proposalSentAt: proposalOrLater ? (request.proposalSentAt ?? daysFromNow(-5)) : request.proposalSentAt,
          convertedAt: r.stage === "won" ? (request.convertedAt ?? daysFromNow(-2)) : request.convertedAt,
          lostAt: r.stage === "lost" || r.stage === "withdrawn" ? (request.lostAt ?? daysFromNow(-1)) : request.lostAt,
          lostFromStage: resolvedLostFromStage ?? request.lostFromStage,
          lostReason: ("lostReason" in r ? r.lostReason : undefined) ?? request.lostReason,
        },
      });
    }

    if ("activities" in r && r.activities) {
      const existingActivityCount = await prisma.clientRequestActivity.count({ where: { requestId: request.id } });
      if (existingActivityCount === 0) {
        for (const a of r.activities) {
          await prisma.clientRequestActivity.create({
            data: {
              requestId: request.id,
              type: a.type,
              summary: a.summary,
              occurredAt: daysFromNow(-a.daysAgo),
              createdBy: r.assignedTo ?? mktLead,
            },
          });
        }
      }
    }

    if ("convertToProject" in r && r.convertToProject) {
      const existingProject = await prisma.project.findFirst({ where: { clientRequestId: request.id } });
      if (!existingProject) {
        await prisma.project.create({
          data: {
            name: r.convertToProject.name,
            departmentId: deptByCode.get(r.dept!)!,
            clientId: request.clientId!,
            status: "active",
            startDate: daysFromNow(-2),
            clientRequestId: request.id,
            createdBy: admin.id,
          },
        });
        await prisma.clientRequest.update({
          where: { id: request.id },
          data: { conversionType: "project" },
        });
      }
    }

    if ("convertToContract" in r && r.convertToContract) {
      const existingContract = await prisma.contract.findFirst({ where: { clientRequestId: request.id } });
      if (!existingContract) {
        await prisma.contract.create({
          data: {
            contractNumber: r.convertToContract.number,
            title: r.title,
            clientId: request.clientId!,
            departmentId: deptByCode.get(r.dept!)!,
            serviceLineId: slByCode.get(r.sl),
            accountManagerId: accountManager,
            clientRequestId: request.id,
            status: "active",
            billingFrequency: r.convertToContract.billing,
            startDate: daysFromNow(-2),
            value: r.value,
            currency: "KES",
            createdBy: admin.id,
          },
        });
        await prisma.clientRequest.update({
          where: { id: request.id },
          data: { conversionType: "recurring_contract" },
        });
      }
    }
  }

  console.log(
    `Seeded ${DEPARTMENTS.length} departments, ${SERVICE_LINES.length} service lines, 1 office, bootstrap admin (${adminEmail}), ${STAFF.length} staff users, ${CLIENTS.length}+ clients, ${contractSeeds.length} contracts, ${invoiceSeeds.length} invoices, ${projectSeeds.length} projects with tasks, ${tenderSeeds.length} tenders across the pipeline, 1 requirement template, financial resourcing on one tender, and ${clientRequestSeeds.length} client requests across the intake pipeline.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
