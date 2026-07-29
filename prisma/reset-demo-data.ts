import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Wipes every seeded/demo TRANSACTIONAL record so the system can be used with real data, without
 * touching login accounts or reference/lookup data.
 *
 * PRESERVED (never deleted): User, UserRole, PasswordSetupToken — every login (bootstrap admin,
 * the demo STAFF accounts, and the one-click DEMO_USERS) — plus Department, ServiceLine, Office,
 * which the app needs to function and aren't "demo content."
 *
 * Everything else — clients, contracts, projects/tasks, invoices, tenders, client requests, leads,
 * campaigns, IT/HR/finance records, documents, notifications, audit log — is deleted.
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
  ]);

  console.log(
    "Demo transactional data cleared. Users, roles, departments, service lines and offices were preserved.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
