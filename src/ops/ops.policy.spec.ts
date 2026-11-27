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
  it("shows saved project tasks to the CEO while keeping standalone work private until its plan is submitted", () => {
    const data = workspace();
    const task = { ...data.tasks[0]!, id: "private-weekly", project: "", assignee: viewer.id };
    data.tasks.push(task);
    const ceo = { ...viewer, id: "ceo", role: "ceo" as const };
    expect(visibleWorkspace(ceo, data).tasks.map((row) => row.id)).toEqual(["task"]);
    expect(
      visibleWorkspace(ceo, data, new Set([`${viewer.id}:private-weekly`])).tasks.map(
        (row) => row.id,
      ),
    ).toEqual(["task", "private-weekly"]);
    expect(
      visibleWorkspace(ceo, data, new Set(["other:private-weekly"])).tasks.map((row) => row.id),
    ).toEqual(["task"]);
    expect(() =>
      authorizeWrite(ceo, "tasks", { ...task, assignee: "other" }, undefined, data),
    ).not.toThrow();
  });
  it("separates business management from finance and never grants all finance businesses by department", () => {
    const data = workspace();
    data.businessAccess = [{ person: viewer.id, business: "business", manage: true }];
    expect(visibleWorkspace(viewer, data).businesses).toHaveLength(1);
    expect(visibleWorkspace(viewer, data).businessFinance).toEqual([]);
    expect(
      visibleWorkspace({ ...viewer, dept: "finance" }, { ...data, businessAccess: [] })
        .businessFinance,
    ).toEqual([]);
    expect(() =>
      authorizeWrite(viewer, "businessFinance", data.businessFinance[0]!, undefined, data),
    ).toThrow();
    data.businessAccess[0]!.finance = "view";
    expect(visibleWorkspace(viewer, data).businessFinance).toHaveLength(1);
    expect(() =>
      authorizeWrite(viewer, "businessFinance", data.businessFinance[0]!, undefined, data),
    ).toThrow();
    data.businessAccess[0]!.finance = "manage";
    expect(() =>
      authorizeWrite(viewer, "businessFinance", data.businessFinance[0]!, undefined, data),
    ).not.toThrow();
  });

  it("uses explicit client and request assignments rather than another handler's department", () => {
    const data = workspace();
    data.clients = [
      { id: "client", name: "Client", contact: "Person", services: ["HR"], assignees: ["other"] },
    ];
    data.clientRequests[0]!.handler = "other";
    expect(visibleWorkspace({ ...viewer, dept: "operations" }, data).clientRequests).toEqual([]);
    expect(visibleWorkspace(viewer, data).clients).toEqual([]);
    data.clients[0]!.assignedDept = "hr";
    data.clientRequests[0]!.assignedDept = "hr";
    expect(visibleWorkspace(viewer, data).clients).toHaveLength(1);
    expect(visibleWorkspace(viewer, data).clientRequests).toHaveLength(1);
  });

  it("includes a request's client without granting client write access or unrelated clients", () => {
    const data = workspace();
    const client: Records["clients"] = {
      id: "client",
      name: "Assigned request client",
      contact: "Contact",
      services: ["HR"],
      assignees: ["other"],
    };
    data.clients = [client, { ...client, id: "unrelated" }];
    data.clientRequests = [
      { ...data.clientRequests[0]!, client: client.id, prospectClientName: undefined },
    ];
    expect(visibleWorkspace(viewer, data).clients.map((row) => row.id)).toEqual(["client"]);
    expect(() => authorizeWrite(viewer, "clients", client, client, data)).toThrow("permission");
    data.clientRequests[0]!.handler = "other";
    expect(visibleWorkspace(viewer, data).clients).toEqual([]);
    data.clientRequests[0]!.assignedDept = viewer.dept!;
    expect(visibleWorkspace(viewer, data).clients.map((row) => row.id)).toEqual(["client"]);
  });

  it("allows own standalone urgent tasks and denies assigning someone else's work", () => {
    const data = workspace();
    const task = {
      ...data.tasks[0]!,
      project: "",
      assignee: viewer.id,
      source: "contingency" as const,
      priority: "Urgent" as const,
      subtasks: [{ id: "subtask", title: "Check", done: false }],
    };
    expect(() => authorizeWrite(viewer, "tasks", task, undefined, data)).not.toThrow();
    expect(() =>
      authorizeWrite(viewer, "tasks", { ...task, assignee: "other" }, task, data),
    ).toThrow();
    expect(() =>
      authorizeWrite(
        viewer,
        "tasks",
        { ...task, subtasks: [{ ...task.subtasks[0]!, done: true }] },
        task,
        data,
      ),
    ).not.toThrow();
  });
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

  it("allows CEO task assignment and keeps report review separate from staff submissions", () => {
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
    expect(() =>
      authorizeWrite(
        ceo,
        "tasks",
        { ...data.tasks[0]!, id: "ceo-assigned-task", assignee: "other" },
        undefined,
        data,
      ),
    ).not.toThrow();
  });

  it("allows staff to create a project led by themselves in their department", () => {
    const data = workspace();
    const project = {
      ...data.projects[0]!,
      id: "staff-created-project",
      lead: viewer.id,
      members: [viewer.id],
      depts: [viewer.dept!],
    };
    expect(() => authorizeWrite(viewer, "projects", project, undefined, data)).not.toThrow();
  });

  it("allows an assignee to change task status and reserves assignment changes for the lead", () => {
    const data = workspace();
    const assignee = { ...viewer, id: "other", dept: "it" as const };
    const task = data.tasks[0];
    expect(() =>
      authorizeWrite(assignee, "tasks", { ...task, status: "Done" }, task, data),
    ).not.toThrow();
    expect(() =>
      authorizeWrite(
        assignee,
        "tasks",
        {
          ...task,
          description:
            '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Shortlist</p></li></ul>',
          status: "Done",
        },
        task,
        data,
      ),
    ).not.toThrow();
    expect(() =>
      authorizeWrite(assignee, "tasks", { ...task, title: "Changed assignment" }, task, data),
    ).toThrow("permission");
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

  it("requires existing authority before moving projects or standalone tasks between businesses", () => {
    const data = workspace();
    data.businessAccess = [{ person: viewer.id, business: "managed", manage: true }];
    const project = { ...data.projects[0], business: "other-business", lead: "other" };
    const task = { ...data.tasks[0], project: "", business: "other-business" };
    expect(() =>
      authorizeWrite(viewer, "projects", { ...project, business: "managed" }, project, data),
    ).toThrow("permission");
    expect(() =>
      authorizeWrite(viewer, "tasks", { ...task, business: "managed" }, task, data),
    ).toThrow("permission");
    data.businessAccess.push({ person: viewer.id, business: "other-business", manage: true });
    expect(() =>
      authorizeWrite(viewer, "projects", { ...project, business: "managed" }, project, data),
    ).not.toThrow();
    expect(() =>
      authorizeWrite(viewer, "tasks", { ...task, business: "managed" }, task, data),
    ).not.toThrow();
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
