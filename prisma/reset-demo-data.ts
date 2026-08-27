import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// The 7 department-lead demo accounts the old seed.ts used to create, plus the 3 one-click
// DEMO_USERS the app used to expose (that feature and this seed block are both gone from the
// codebase now — this list only matters for cleaning up a database seeded before that change).
const DEMO_STAFF_EMAILS = [
  "florence.wanjiru@amsol.com",
  "grace.mwangi@amsol.com",
  "peter.otieno@amsol.com",
  "samuel.kiptoo@amsol.com",
  "amina.yusuf@amsol.com",
  "david.mutua@amsol.com",
  "linda.achieng@amsol.com",
  "admin@amsol.demo",
  "ceo@amsol.demo",
  "finance@amsol.demo",
];

/**
 * Wipes every seeded/demo TRANSACTIONAL record, AND the old demo staff/one-click accounts, so the
 * system is left with only the bootstrap System Administrator and reference/lookup data — matching
 * what prisma/seed.ts now creates on a fresh database.
 *
 * PRESERVED: the bootstrap System Administrator's User/UserRole/PasswordSetupToken rows, plus
 * Department, ServiceLine, Office — reference/lookup data the app needs to function, not "demo
 * content." Any OTHER user you've since created for real (via Admin > Users) is also preserved —
 * only the specific demo emails above are removed.
 *
 * Everything else — clients, contracts, projects/tasks, invoices, tenders, client requests, leads,
 * campaigns, IT/HR/finance records, documents, notifications, audit log, and the demo staff/
 * one-click accounts themselves — is deleted.
 *
 * Deletes run in FK-safe order (children before parents), inside one transaction so a failure
 * partway through leaves the database untouched rather than half-wiped.
 *
 * This is destructive and irreversible. Run manually only, against a database you intend to wipe:
 *   npm run reset:demo-data
 */
async function main() {
  await prisma.$transaction([
    // Leaves / logs with no other dependents
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.documentAccessGrant.deleteMany(),
    prisma.documentVersion.deleteMany(),
    prisma.document.deleteMany(),

    // Task children, then Project children, then Task itself
    prisma.taskComment.deleteMany(),
    prisma.taskDependency.deleteMany(),
    prisma.projectRaidEntry.deleteMany(),
    prisma.projectRaciEntry.deleteMany(),
    prisma.projectTeamMember.deleteMany(),
    prisma.projectCostItem.deleteMany(),
    prisma.projectActivity.deleteMany(),
    prisma.milestone.deleteMany(),
    prisma.recruitmentFunnel.deleteMany(),
    prisma.task.deleteMany(),

    // Contract / Invoice / FinanceReport children
    prisma.contractDocument.deleteMany(),
    prisma.invoicePayment.deleteMany(),
    prisma.financeReportComment.deleteMany(),
    prisma.debtorFollowUp.deleteMany(),

    // Tender children (must go before Tender itself)
    prisma.tenderActivity.deleteMany(),
    prisma.tenderRequirement.deleteMany(),
    prisma.tenderRequirementTemplateItem.deleteMany(),
    prisma.tenderPricingItem.deleteMany(),
    prisma.tenderBond.deleteMany(),
    prisma.tenderCostItem.deleteMany(),
    prisma.tenderTimeEntry.deleteMany(),
    prisma.tenderResource.deleteMany(),

    // Request/Lead activity logs
    prisma.clientRequestActivity.deleteMany(),
    prisma.leadActivity.deleteMany(),

    // Client sub-records (safe once Invoice/Contract/Project/Tender/ClientRequest children above
    // are cleared, but before Client itself further down)
    prisma.hrmsLicense.deleteMany(),
    prisma.clientContact.deleteMany(),

    // Mid-level entities — deletable now their own children are gone
    prisma.project.deleteMany(),
    prisma.contract.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.financeReport.deleteMany(),
    prisma.tenderRequirementTemplate.deleteMany(),
    // Lead holds the FK to ClientRequest (convertedRequestId), so it must go before ClientRequest
    prisma.lead.deleteMany(),

    // Now safe: nothing still references these
    prisma.clientRequest.deleteMany(),
    prisma.tender.deleteMany(),
    prisma.client.deleteMany(),

    // Independent department-scoped transactional data
    prisma.budget.deleteMany(),
    prisma.payrollComplianceRecord.deleteMany(),
    prisma.financeUpload.deleteMany(),
    prisma.campaign.deleteMany(),
    prisma.ticket.deleteMany(),
    prisma.itSystem.deleteMany(),
    prisma.blogPost.deleteMany(),
    prisma.websiteAnalyticsSnapshot.deleteMany(),

    // Old demo staff / one-click accounts — safe now that everything they might have authored
    // (finance reports, task comments, tender resources/time entries — the Cascade relations on
    // User) has already been cleared above. Any real user you've since created keeps their email
    // out of this list, so they're untouched.
    prisma.user.deleteMany({ where: { email: { in: DEMO_STAFF_EMAILS } } }),
  ]);

  console.log(
    "Demo data cleared. Only the bootstrap System Administrator, departments, service lines and offices remain.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
