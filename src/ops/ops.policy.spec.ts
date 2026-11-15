import { describe, expect, it } from "@jest/globals";
import { authorizeWrite, validateWorkspace, visibleWorkspace } from "./ops.policy";
import { parse, schemas, type Records, type Viewer, type Workspace } from "./ops.schemas";

const viewer: Viewer = {
  id: "staff",
  userId: "user",
  sessionId: "session",
  email: "staff@test.local",
  role: "staff",
  active: true,
  name: "Staff",
  title: "Consultant",
  dept: "hr",
};
function workspace(): Workspace {
  return {
    version: 1,
    settings: {
      company: "Ops",
      reminderDays: 7,
      remindersEnabled: true,
      defaultDocumentAccess: "department",
    },
    departments: [{ id: "hr", name: "HR", blurb: "HR", modules: ["Training"] }],
    people: [
      { id: "ceo", name: "CEO", title: "CEO", dept: null },
      { id: "staff", name: "Staff", title: "Consultant", dept: "hr" },
      { id: "other", name: "Other", title: "IT", dept: "it" },
    ],
    accounts: [
      {
        id: "ceo",
        personId: "ceo",
        email: "ceo@test.local",
        role: "ceo",
        active: true,
        hasPassword: true,
      },
    ],
    clients: [],
    projects: [
      {
        id: "project",
        name: "Project",
        lead: "staff",
        members: ["staff", "other"],
        depts: ["hr"],
        stage: "In progress",
        status: "on-track",
        progress: 40,
        due: "2026-12-01",
        summary: "Delivery",
      },
    ],
    tasks: [
      {
        id: "task",
        title: "Task",
        project: "project",
        assignee: "other",
        due: "2026-12-01",
        priority: "High",
        status: "To do",
      },
    ],
    reports: [],
    documents: [],
    tenders: [],
    clientRequests: [
      {
        id: "request",
        title: "Prospective request",
        prospectClientName: "Example client",
        source: "operations",
        received: "2026-11-01",
        handler: "staff",
        status: "Received",
      },
    ],
    businesses: [{ id: "business", name: "Restricted", sector: "Services" }],
    businessFinance: [
      {
        id: "finance",
        business: "business",
        month: "2026-11",
        date: "2026-11-01",
        description: "Monthly summary",
        revenue: 1000,
        expenses: 400,
      },
    ],
    businessAccess: [],
    staffBusiness: [],
    moduleRecords: [],
    templates: [],
  };
}

describe("Ops permission and workflow boundaries", () => {
  it("blocks self-promotion through staff profiles and permissions through view changes", () => {
    const data = workspace();
    expect(() =>
      authorizeWrite(
        viewer,
        "people",
        { ...data.people[1], dept: "finance" },
        data.people[1],
        data,
      ),
    ).toThrow("permission");
    expect(visibleWorkspace(viewer, data).businessFinance).toEqual([]);
    expect(visibleWorkspace(viewer, data).businesses).toEqual([]);
  });

  it("keeps System Admin out of operational data and record writes", () => {
    const data = workspace();
    const admin = { ...viewer, id: "system-admin", role: "system_admin" as const };
    const visible = visibleWorkspace(admin, data);
    expect(visible.projects).toEqual([]);
    expect(visible.tasks).toEqual([]);
    expect(visible.reports).toEqual([]);
    expect(() =>
      authorizeWrite(
        admin,
        "clients",
        {
          id: "client",
          name: "Client",
          contact: "contact",
          services: ["Consulting"],
        },
        undefined,
        data,
      ),
    ).toThrow("System administrator");
  });

  it("hides System Admin accounts and profiles from CEO workspace data", () => {
    const data = workspace();
    data.people.push({
      id: "system-admin",
      name: "System Admin",
      title: "System administrator",
      dept: null,
    });
    data.people.push({
      id: "other-system-admin",
      name: "Other System Admin",
      title: "System administrator",
      dept: null,
    });
    data.accounts.push({
      id: "system-admin-account",
      personId: "system-admin",
      email: "admin@test.local",
      role: "system_admin",
      active: true,
      hasPassword: true,
    });
    data.accounts.push({
      id: "other-system-admin-account",
      personId: "other-system-admin",
      email: "other-admin@test.local",
      role: "system_admin",
      active: true,
      hasPassword: true,
    });
    const visible = visibleWorkspace({ ...viewer, role: "ceo" }, data);
    expect(visible.people.map((person) => person.id)).not.toContain("system-admin");
    expect(visible.accounts.map((account) => account.role)).not.toContain("system_admin");

    const ownAdminWorkspace = visibleWorkspace(
      { ...viewer, id: "system-admin", role: "system_admin" },
      data,
    );
    expect(ownAdminWorkspace.people.map((person) => person.id)).toContain("system-admin");
    expect(
      ownAdminWorkspace.accounts.find((account) => account.personId === "system-admin")?.role,
    ).toBe("system_admin");
    expect(ownAdminWorkspace.people.map((person) => person.id)).toContain("ceo");
    expect(ownAdminWorkspace.people.map((person) => person.id)).not.toContain("other-system-admin");
  });

  it("keeps CEO report review separate from staff report submissions and client intake", () => {
    const data = workspace();
    const ceo = { ...viewer, id: "ceo", role: "ceo" as const };
    const client = {
      id: "new-client",
      name: "New Client",
      contact: "contact",
      services: ["Consulting"],
    };
    const request = {
      ...data.clientRequests[0],
      id: "new-request",
    };
    const report: Records["reports"] = {
      id: "report",
      title: "Weekly update",
      type: "Weekly department",
      author: "ceo",
      dept: "hr",
      date: "2026-11-15",
      progress: "Complete",
      blockers: "",
      next: "",
      reviewed: false,
    };

    expect(() => authorizeWrite(ceo, "clients", client, undefined, data)).toThrow(
      "cannot create client records",
    );
    expect(() => authorizeWrite(ceo, "clientRequests", request, undefined, data)).toThrow(
      "cannot create client records",
    );
    expect(() => authorizeWrite(ceo, "reports", report, undefined, data)).toThrow(
      "review reports through the report review action",
    );
  });

  it("allows an assignee to change task status and reserves assignment changes for the lead", () => {
    const data = workspace();
    const assignee = { ...viewer, id: "other", dept: "it" as const };
    const task = data.tasks[0];
    expect(() =>
      authorizeWrite(assignee, "tasks", { ...task, status: "Done" }, task, data),
    ).not.toThrow();
    expect(() =>
      authorizeWrite(assignee, "tasks", { ...task, assignee: "staff" }, task, data),
    ).toThrow("permission");
    expect(() =>
      authorizeWrite(viewer, "tasks", { ...task, assignee: "staff" }, task, data),
    ).not.toThrow();
  });

  it("prevents team removals that orphan tasks and inconsistent project completion", () => {
    const data = workspace();
    expect(() =>
      validateWorkspace({ ...data, projects: [{ ...data.projects[0], members: ["staff"] }] }),
    ).toThrow("Reassign");
    expect(() =>
      validateWorkspace({ ...data, projects: [{ ...data.projects[0], status: "completed" }] }),
    ).toThrow("100%");
  });

  it("retains a usable CEO and validates real dates and unexpected payload fields", () => {
    const data = workspace();
    expect(() =>
      validateWorkspace({
        ...data,
        accounts: data.accounts.map((account) => ({ ...account, active: false })),
      }),
    ).toThrow("active CEO");
    const task = {
      ...data.tasks[0],
      id: "22390d68-3592-4a8c-8ebd-20f126110a3f",
      project: "44390d68-3592-4a8c-8ebd-20f126110a3f",
      assignee: "55390d68-3592-4a8c-8ebd-20f126110a3f",
    };
    expect(() => parse(schemas.tasks, { ...task, due: "2026-02-30" })).toThrow("valid date");
    expect(() => parse(schemas.tasks, { ...task, admin: true })).toThrow();
    expect(() =>
      parse(schemas.departments, {
        id: "customer-service",
        name: "Customer Service",
        blurb: "Client operations",
        modules: [],
      }),
    ).not.toThrow();
    expect(() =>
      parse(schemas.departments, {
        id: "Customer-Service",
        name: "Customer Service",
        blurb: "Client operations",
        modules: [],
      }),
    ).toThrow();
  });
});
