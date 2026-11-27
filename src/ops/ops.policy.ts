import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Collection, Records, Viewer, Workspace } from "./ops.schemas";

export function assertCeo(viewer: Viewer) {
  if (viewer.role !== "ceo") throw new ForbiddenException("CEO access is required.");
}

export function assertSystemAdmin(viewer: Viewer) {
  if (viewer.role !== "system_admin")
    throw new ForbiddenException("System administrator access is required.");
}

export function canReadProject(viewer: Viewer, project: Records["projects"]) {
  return (
    viewer.role === "ceo" ||
    project.members.includes(viewer.id) ||
    (!!viewer.dept && project.depts.includes(viewer.dept))
  );
}

export function businessGrant(viewer: Viewer, data: Workspace, business = "b0") {
  return data.businessAccess.find(
    (grant) => grant.person === viewer.id && grant.business === business,
  );
}

export function canReadBusiness(viewer: Viewer, data: Workspace, business = "b0") {
  return (
    viewer.role === "ceo" ||
    business === "b0" ||
    !!businessGrant(viewer, data, business) ||
    data.staffBusiness.some((grant) => grant.person === viewer.id && grant.business === business)
  );
}

export function canReadFinance(viewer: Viewer, data: Workspace, business: string) {
  return viewer.role === "ceo" || !!businessGrant(viewer, data, business)?.finance;
}

export function canReadDocument(viewer: Viewer, doc: Records["documents"], data: Workspace) {
  if (doc.report) {
    const report = data.reports.find((row) => row.id === doc.report);
    if (!report || (report.status === "draft" && report.author !== viewer.id)) return false;
    return viewer.role === "ceo" || report.author === viewer.id;
  }
  if (viewer.role === "ceo" || doc.owner === viewer.id || doc.access === "public") return true;
  if (doc.access === "department") return doc.dept === viewer.dept;
  if (doc.access === "project")
    return data.projects.some(
      (project) => project.id === doc.project && project.members.includes(viewer.id),
    );
  return !!doc.allowed?.includes(viewer.id);
}

export function visibleWorkspace(
  viewer: Viewer,
  data: Workspace,
  publishedTasks: ReadonlySet<string> = new Set(),
): Workspace {
  const withoutSystemAdmins = {
    ...data,
    people: data.people.filter(
      (person) =>
        !data.accounts.some(
          (account) => account.role === "system_admin" && account.personId === person.id,
        ),
    ),
    accounts: data.accounts.filter((account) => account.role !== "system_admin"),
  };
  if (viewer.role === "system_admin") {
    const ownPerson = data.people.find((person) => person.id === viewer.id);
    const ownAccount = data.accounts.find(
      (account) => account.personId === viewer.id && account.role === "system_admin",
    );
    return {
      ...withoutSystemAdmins,
      people: ownPerson ? [...withoutSystemAdmins.people, ownPerson] : withoutSystemAdmins.people,
      accounts: ownAccount
        ? [...withoutSystemAdmins.accounts, ownAccount]
        : withoutSystemAdmins.accounts,
      clients: [],
      projects: [],
      tasks: [],
      reports: [],
      tenders: [],
      clientRequests: [],
      businesses: [],
      businessFinance: [],
      businessAccess: [],
      staffBusiness: [],
      documents: [],
      moduleRecords: [],
      templates: [],
    };
  }
  if (viewer.role === "ceo")
    return {
      ...withoutSystemAdmins,
      tasks: data.tasks.filter(
        (task) =>
          task.project ||
          task.assignee === viewer.id ||
          publishedTasks.has(`${task.assignee}:${task.id}`),
      ),
      reports: data.reports.filter(
        (report) => report.status !== "draft" || report.author === viewer.id,
      ),
      documents: data.documents.filter(
        (doc) =>
          canReadDocument(viewer, doc, data) &&
          (!doc.task ||
            data.tasks.some(
              (task) =>
                task.id === doc.task &&
                (task.project ||
                  task.assignee === viewer.id ||
                  publishedTasks.has(`${task.assignee}:${task.id}`)),
            )),
      ),
    };
  const projects = data.projects.filter(
    (project) =>
      canReadProject(viewer, project) || businessGrant(viewer, data, project.business)?.manage,
  );
  const projectIds = new Set(projects.map((project) => project.id));
  const businesses = data.businesses.filter((business) =>
    canReadBusiness(viewer, data, business.id),
  );
  const requests = data.clientRequests.filter(
    (request) =>
      request.handler === viewer.id ||
      (!!viewer.dept && request.assignedDept === viewer.dept) ||
      businessGrant(viewer, data, request.business)?.manage,
  );
  return {
    ...withoutSystemAdmins,
    projects,
    clients: data.clients.filter(
      (client) =>
        client.assignees?.includes(viewer.id) ||
        (!!viewer.dept && client.assignedDept === viewer.dept) ||
        businessGrant(viewer, data, client.business)?.manage ||
        projects.some((project) => project.client === client.id) ||
        requests.some((request) => request.client === client.id),
    ),
    tasks: data.tasks.filter(
      (task) =>
        task.assignee === viewer.id ||
        projectIds.has(task.project) ||
        businessGrant(viewer, data, task.business)?.manage,
    ),
    reports: data.reports.filter(
      (report) =>
        (report.status !== "draft" || report.author === viewer.id) &&
        (report.author === viewer.id ||
          report.dept === viewer.dept ||
          (!!report.project && projectIds.has(report.project))),
    ),
    documents: data.documents.filter((doc) => canReadDocument(viewer, doc, data)),
    tenders: data.tenders.filter((tender) => tender.members.includes(viewer.id)),
    clientRequests: requests,
    businesses,
    businessFinance: data.businessFinance.filter((row) =>
      canReadFinance(viewer, data, row.business),
    ),
    businessAccess: data.businessAccess.filter((grant) => grant.person === viewer.id),
    staffBusiness: data.staffBusiness.filter((grant) => grant.person === viewer.id),
    accounts: data.accounts.filter((account) => account.personId === viewer.id),
    moduleRecords: data.moduleRecords.filter((record) => record.dept === viewer.dept),
  };
}

export function authorizeWrite<K extends Collection>(
  viewer: Viewer,
  collection: K,
  next: Records[K],
  previous: Records[K] | undefined,
  data: Workspace,
  deleting = false,
) {
  if (viewer.role === "system_admin")
    throw new ForbiddenException(
      "System administrator accounts cannot change operational records.",
    );
  if (viewer.role === "ceo") {
    if (collection === "reports")
      throw new ForbiddenException("CEO accounts review reports through the report review action.");
    if (!previous && (collection === "clients" || collection === "clientRequests"))
      throw new ForbiddenException(
        "CEO accounts cannot create client records or log client requests.",
      );
    return;
  }
  let allowed = false;
  switch (collection) {
    case "people": {
      const person = next as Records["people"];
      const old = previous as Records["people"] | undefined;
      allowed =
        !deleting &&
        person.id === viewer.id &&
        !!old &&
        person.title === old.title &&
        person.dept === old.dept;
      break;
    }
    case "clients": {
      const client = next as Records["clients"];
      const old = previous as Records["clients"] | undefined;
      allowed =
        !deleting &&
        (!old ||
          !!old.assignees?.includes(viewer.id) ||
          old.assignedDept === viewer.dept ||
          !!businessGrant(viewer, data, old.business)?.manage) &&
        canReadBusiness(viewer, data, client.business) &&
        (!!client.assignees?.includes(viewer.id) ||
          (!!viewer.dept && client.assignedDept === viewer.dept) ||
          !!businessGrant(viewer, data, client.business)?.manage);
      break;
    }
    case "projects": {
      const project = next as Records["projects"];
      const old = previous as Records["projects"] | undefined;
      allowed =
        (!!businessGrant(viewer, data, project.business)?.manage &&
          (!old ||
            old.lead === viewer.id ||
            !!businessGrant(viewer, data, old.business)?.manage)) ||
        (old
          ? old.lead === viewer.id && project.lead === viewer.id
          : !deleting &&
            project.lead === viewer.id &&
            !!viewer.dept &&
            project.depts.includes(viewer.dept));
      allowed = allowed && canReadBusiness(viewer, data, project.business);
      break;
    }
    case "tasks": {
      const task = next as Records["tasks"];
      const old = previous as Records["tasks"] | undefined;
      if (!task.project && (!old || !old.project)) {
        allowed =
          canReadBusiness(viewer, data, task.business) &&
          ((task.assignee === viewer.id && (!old || old.assignee === viewer.id)) ||
            (!!businessGrant(viewer, data, task.business)?.manage &&
              (!old ||
                old.assignee === viewer.id ||
                !!businessGrant(viewer, data, old.business)?.manage)));
        break;
      }
      const project = data.projects.find((item) => item.id === task.project);
      const oldProject = old && data.projects.find((item) => item.id === old.project);
      const businessManager =
        !!businessGrant(viewer, data, project?.business)?.manage &&
        (!oldProject || !!businessGrant(viewer, data, oldProject.business)?.manage);
      if (
        !businessManager &&
        (!project?.members.includes(viewer.id) || (old && !oldProject?.members.includes(viewer.id)))
      )
        break;
      const manages =
        businessManager ||
        (project?.lead === viewer.id && (!old || oldProject?.lead === viewer.id));
      const ownStatus =
        old?.assignee === viewer.id &&
        Object.entries(task).every(
          ([key, value]) =>
            ["status", "subtasks", "description"].includes(key) ||
            JSON.stringify(value) === JSON.stringify(old[key as keyof typeof old]),
        );
      allowed = manages || (!deleting && !!ownStatus) || (!old && task.assignee === viewer.id);
      break;
    }
    case "reports": {
      const report = next as Records["reports"];
      const old = previous as Records["reports"] | undefined;
      const project = report.project && data.projects.find((item) => item.id === report.project);
      allowed =
        canReadBusiness(viewer, data, report.business) &&
        report.author === viewer.id &&
        !report.reviewed &&
        !report.comment &&
        (!old || (old.author === viewer.id && !old.reviewed)) &&
        (project ? project.members.includes(viewer.id) : report.dept === viewer.dept);
      break;
    }
    case "documents": {
      const doc = next as Records["documents"];
      const old = previous as Records["documents"] | undefined;
      allowed =
        doc.owner === viewer.id &&
        (!old || old.owner === viewer.id) &&
        (!doc.task ||
          data.tasks.some(
            (task) =>
              task.id === doc.task &&
              (task.project || undefined) === doc.project &&
              (task.project || task.assignee === viewer.id),
          )) &&
        (!old || old.task === doc.task) &&
        (!doc.project ||
          data.projects.some(
            (project) => project.id === doc.project && project.members.includes(viewer.id),
          )) &&
        (!doc.dept || doc.dept === viewer.dept);
      break;
    }
    case "tenders": {
      const tender = next as Records["tenders"];
      const old = previous as Records["tenders"] | undefined;
      allowed = tender.members.includes(viewer.id) && (!old || old.members.includes(viewer.id));
      break;
    }
    case "clientRequests": {
      const request = next as Records["clientRequests"];
      const old = previous as Records["clientRequests"] | undefined;
      allowed =
        canReadBusiness(viewer, data, request.business) &&
        (!old ||
          old.handler === viewer.id ||
          (!!viewer.dept && old.assignedDept === viewer.dept) ||
          !!businessGrant(viewer, data, old.business)?.manage) &&
        (request.handler === viewer.id ||
          (!!viewer.dept && request.assignedDept === viewer.dept) ||
          !!businessGrant(viewer, data, request.business)?.manage);
      break;
    }
    case "businesses":
      allowed = !!previous && !deleting && !!businessGrant(viewer, data, next.id)?.manage;
      break;
    case "businessFinance": {
      const row = next as Records["businessFinance"];
      const old = previous as Records["businessFinance"] | undefined;
      allowed =
        businessGrant(viewer, data, row.business)?.finance === "manage" &&
        (!old || businessGrant(viewer, data, old.business)?.finance === "manage");
      break;
    }
    case "moduleRecords": {
      const record = next as Records["moduleRecords"];
      const old = previous as Records["moduleRecords"] | undefined;
      allowed =
        record.dept === viewer.dept &&
        record.owner === viewer.id &&
        (!old || (old.owner === viewer.id && old.dept === viewer.dept));
      break;
    }
  }
  if (!allowed) throw new ForbiddenException("You do not have permission to change this record.");
}

export function validateWorkspace(data: Workspace) {
  const person = (id: string) => data.people.some((row) => row.id === id);
  const project = (id: string) => data.projects.find((row) => row.id === id);
  const client = (id: string) => data.clients.some((row) => row.id === id);
  const business = (id: string) => data.businesses.some((row) => row.id === id);
  const fail = (message: string): never => {
    throw new BadRequestException(message);
  };
  for (const row of data.projects) {
    if (
      !person(row.lead) ||
      row.members.some((id) => !person(id)) ||
      (row.client && !client(row.client))
    )
      fail("Project staff and clients must exist.");
    if (!row.members.includes(row.lead)) fail("The project lead must be a team member.");
    const completed =
      row.status === "completed" || row.stage === "Completed" || row.progress === 100;
    if (
      completed &&
      !(row.status === "completed" && row.stage === "Completed" && row.progress === 100)
    )
      fail("Completed projects require Completed stage, completed status and 100% progress.");
  }
  for (const row of data.tasks)
    if (
      !person(row.assignee) ||
      (row.project && !project(row.project)?.members.includes(row.assignee))
    )
      fail(
        "Tasks must be assigned to project team members. Reassign their tasks before removing a team member.",
      );
  for (const row of data.documents)
    if (
      row.task &&
      !data.tasks.some(
        (task) => task.id === row.task && (task.project || undefined) === row.project,
      )
    )
      fail("Task attachments must belong to a task in the selected project.");
  for (const row of data.reports) {
    if (!person(row.author) || (row.project && !project(row.project)))
      fail("Report staff and projects must exist.");
    if (row.type === "Project update" && !row.project) fail("Project updates require a project.");
    if (row.project && !project(row.project)?.depts.includes(row.dept))
      fail("Choose a department involved in the project.");
  }
  for (const row of [
    ...data.clients,
    ...data.projects,
    ...data.tasks,
    ...data.reports,
    ...data.clientRequests,
  ])
    if (row.business && !business(row.business)) fail("Choose an existing business.");
  for (const row of data.clients)
    if (
      row.assignees?.some((id) => !person(id)) ||
      (row.assignedDept && !data.departments.some((dept) => dept.id === row.assignedDept))
    )
      fail("Choose existing staff and departments for client assignments.");
  for (const row of data.clientRequests)
    if (row.assignedDept && !data.departments.some((dept) => dept.id === row.assignedDept))
      fail("Choose an existing request department.");
  for (const row of data.clientRequests)
    if (
      (!!row.client && !client(row.client)) ||
      !person(row.handler) ||
      !!row.client === !!row.prospectClientName
    )
      fail("Choose one existing or prospective client and an existing handler.");
  for (const row of data.tenders)
    if (row.members.some((id) => !person(id))) fail("Tender staff must exist.");
  for (const row of data.businessFinance)
    if (!business(row.business)) fail("Choose an existing business.");
  for (const row of data.businessFinance)
    if (row.date.slice(0, 7) !== row.month)
      fail("Finance entry date and reporting month must match.");
  for (const row of [...data.businessAccess, ...data.staffBusiness])
    if (!person(row.person) || !business(row.business))
      fail("Business grants must reference existing staff and businesses.");
  for (const row of data.documents) {
    if (
      row.report &&
      !data.reports.some((report) => report.id === row.report && report.author === row.owner)
    )
      fail("Report attachments must belong to an existing report by their owner.");
    if (
      !person(row.owner) ||
      (row.project && !project(row.project)) ||
      row.allowed?.some((id) => !person(id))
    )
      fail("Document references must exist.");
    if (
      (row.access === "project" && !row.project) ||
      (row.access === "department" && !row.dept) ||
      (row.access === "restricted" && !row.allowed?.length)
    )
      fail("Choose the staff, project or department that can access this document.");
  }
  for (const row of data.moduleRecords)
    if (
      !person(row.owner) ||
      !data.departments.find((dept) => dept.id === row.dept)?.modules.includes(row.module)
    )
      fail(
        "Choose an existing staff member and department module. Remove module records before removing a module.",
      );
  for (const row of data.accounts)
    if (!person(row.personId)) fail("Accounts must belong to existing staff.");
  if (!data.accounts.some((row) => row.active && row.role === "ceo" && row.hasPassword))
    fail("Keep at least one active CEO with a password.");
}
