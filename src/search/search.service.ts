import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { DocumentsService } from "../documents/documents.service";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";

export interface SearchResult {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  to: string;
}

const TAKE_PER_TYPE = 5;
const MIN_QUERY_LENGTH = 2;

function canSeeFinance(viewer: AuthenticatedUser): boolean {
  return viewer.roles.some((r) => r === "finance" || r === "ceo" || r === "system_admin");
}

// A single cross-module search — the AIMS data model connects Leads through to Contracts, but
// department nav trees make it slow to jump straight to a record you already know the name of.
// Each searched type mirrors the read-access rule its own list endpoint already enforces: types
// with an open `@Roles()` list endpoint are queried unconditionally here too; types gated behind
// a role (Invoices -> finance) are only queried when the viewer actually holds that role;
// Documents has real per-row access grants, so that one delegates to DocumentsService.findAll()
// rather than re-implementing the grant logic here.
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
  ) {}

  async search(q: string | undefined, viewer: AuthenticatedUser): Promise<SearchResult[]> {
    const query = q?.trim() ?? "";
    if (query.length < MIN_QUERY_LENGTH) return [];

    const [leads, requests, tenders, projects, contracts, clients, posts, systems, tickets, campaigns, invoices, documents] =
      await Promise.all([
        this.prisma.lead.findMany({
          where: { name: { contains: query } },
          take: TAKE_PER_TYPE,
          select: { id: true, name: true, company: true },
        }),
        this.prisma.clientRequest.findMany({
          where: { title: { contains: query } },
          take: TAKE_PER_TYPE,
          select: { id: true, title: true, prospectClientName: true, client: { select: { name: true } } },
        }),
        this.prisma.tender.findMany({
          where: { title: { contains: query } },
          take: TAKE_PER_TYPE,
          select: { id: true, title: true, referenceNumber: true },
        }),
        this.prisma.project.findMany({
          where: { name: { contains: query } },
          take: TAKE_PER_TYPE,
          select: { id: true, name: true },
        }),
        this.prisma.contract.findMany({
          where: { OR: [{ title: { contains: query } }, { contractNumber: { contains: query } }] },
          take: TAKE_PER_TYPE,
          select: { id: true, title: true, contractNumber: true },
        }),
        this.prisma.client.findMany({
          where: { name: { contains: query } },
          take: TAKE_PER_TYPE,
          select: { id: true, name: true },
        }),
        this.prisma.blogPost.findMany({
          where: { title: { contains: query } },
          take: TAKE_PER_TYPE,
          select: { id: true, title: true, status: true },
        }),
        this.prisma.itSystem.findMany({
          where: { name: { contains: query } },
          take: TAKE_PER_TYPE,
          select: { id: true, name: true },
        }),
        this.prisma.ticket.findMany({
          where: { title: { contains: query } },
          take: TAKE_PER_TYPE,
          select: { id: true, title: true, status: true },
        }),
        this.prisma.campaign.findMany({
          where: { name: { contains: query } },
          take: TAKE_PER_TYPE,
          select: { id: true, name: true, channel: true },
        }),
        canSeeFinance(viewer)
          ? this.prisma.invoice.findMany({
              where: { invoiceNumber: { contains: query } },
              take: TAKE_PER_TYPE,
              select: { id: true, invoiceNumber: true, client: { select: { name: true } } },
            })
          : Promise.resolve([]),
        this.documentsService
          .findAll({ q: query }, viewer)
          .then((result) => (Array.isArray(result) ? result : result.data).slice(0, TAKE_PER_TYPE)),
      ]);

    return [
      ...leads.map((l): SearchResult => ({
        type: "lead",
        id: l.id,
        title: l.name,
        subtitle: l.company ?? "Lead",
        to: "/marketing/leads",
      })),
      ...requests.map((r): SearchResult => ({
        type: "client_request",
        id: r.id,
        title: r.title,
        subtitle: r.client?.name ?? r.prospectClientName ?? "Client Request",
        to: `/requests/${r.id}`,
      })),
      ...tenders.map((t): SearchResult => ({
        type: "tender",
        id: t.id,
        title: t.title,
        subtitle: t.referenceNumber ?? "Tender",
        to: `/tender/${t.id}`,
      })),
      ...projects.map((p): SearchResult => ({
        type: "project",
        id: p.id,
        title: p.name,
        subtitle: "Project",
        to: `/projects/${p.id}`,
      })),
      ...contracts.map((c): SearchResult => ({
        type: "contract",
        id: c.id,
        title: c.title,
        subtitle: c.contractNumber ?? "Contract",
        to: `/clients/contracts/${c.id}`,
      })),
      ...clients.map((c): SearchResult => ({
        type: "client",
        id: c.id,
        title: c.name,
        subtitle: "Client",
        to: "/clients",
      })),
      ...posts.map((p): SearchResult => ({
        type: "blog_post",
        id: p.id,
        title: p.title,
        subtitle: p.status === "published" ? "Blog · Published" : "Blog · Draft",
        to: `/marketing/blog/${p.id}`,
      })),
      ...systems.map((s): SearchResult => ({
        type: "it_system",
        id: s.id,
        title: s.name,
        subtitle: "System & Site",
        to: "/it/systems-sites",
      })),
      ...tickets.map((t): SearchResult => ({
        type: "ticket",
        id: t.id,
        title: t.title,
        subtitle: `Ticket · ${t.status.replace("_", " ")}`,
        to: "/it/tickets",
      })),
      ...campaigns.map((c): SearchResult => ({
        type: "campaign",
        id: c.id,
        title: c.name,
        subtitle: c.channel ?? "Campaign",
        to: "/marketing/campaigns",
      })),
      ...invoices.map((i): SearchResult => ({
        type: "invoice",
        id: i.id,
        title: i.invoiceNumber,
        subtitle: i.client?.name ?? "Invoice",
        to: "/finance/invoices",
      })),
      ...documents.map((d): SearchResult => ({
        type: "document",
        id: d.id,
        title: d.title,
        subtitle: "Document",
        to: "/documents",
      })),
    ];
  }
}
