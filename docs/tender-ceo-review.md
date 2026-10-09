# Tender workflow and CEO reporting

Implemented on 8 October 2026. HR represents services delivered to clients. The Water and blog source modules are unchanged.

## Tender work

The Tender home starts with closing bids, checklist gaps and awards awaiting a delivery project. Registering a bid requires its title and delivering department. Client and closing date are visible immediately; reference, service line, value and description are optional details. The registering person becomes the bid owner unless another owner is supplied.

After registration, the bid opens on its checklist. Staff prepare requirements, attach documents and record work in Activity. Recording submission asks for confirmation when the checklist is unavailable, empty or incomplete, or when the owner or deadline is missing. This records an actual submission rather than preventing staff from documenting what happened. An award can then be forwarded through the existing delivery-project workflow.

Queue previews return at most six bids per list with separate full counts. Submitted bids are excluded from preparation reminders. Corrections to outcome notes preserve existing award and exit dates and the original stage from which a bid exited.

## CEO views

`GET /api/v1/executive-overview` supplies the default CEO dashboard. It aggregates company and core department projects, highlights late or blocked delivery, shows the oldest reports awaiting the CEO, and previews recent project updates. Review previews are capped at six; project and update previews at eight. Counts are computed in the database.

Department reporting coverage uses the previous calendar month's department work report. Personal reports, project reports and financial snapshots do not satisfy that obligation. Nairobi calendar dates are used at month and day boundaries. Water remains outside this overview's department scope.

The reports inbox distinguishes decisions waiting on the CEO from reports with department heads. Financial snapshots now appear in the CEO queue. Search, department and period filters and pages of 25 rows support finding reports. Monthly board packs include approved department reports and financial snapshots covering that month; personal and project reports are excluded. PDF code loads when requested. Existing financial and project analytics remain available from the overview.

## Access rules enforced by the API

| Resource           | Read access                                                                                                                                           | Write access                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Department project | Resolved department read access for department-visible work; creator with department read access, team invitation or record grant for restricted work | Resolved department write access after visibility checks, or an explicit record write grant       |
| Company project    | CEO, system administrator, lead or team member                                                                                                        | Lead and members can add work; project and team management stays with the lead and administrators |
| Task               | Readable parent project or the assigned person                                                                                                        | Parent project write access or the existing assignee exception                                    |
| Tender             | Tender pipeline access, delivering department access, bid owner, assigned resource or a record grant                                                  | Existing Tender module permission or a record write grant                                         |
| Report             | Its department, project or personal-report policy; another person's personal or project draft stays private                                           | Existing report author, subject and capability checks                                             |
| Default attachment | Its attached record's visibility                                                                                                                      | Existing parent write checks; report attachments reuse report access checks                       |

Project and tender child endpoints now check their parent before returning costs, checklists, resources, activity or planning data. Document downloads bind both an explicit version and the latest-version pointer to the requested document. Default attachment lists and direct reads apply the parent scope. Explicit file shares and uploader access retain their existing behavior, so removing department access alone does not revoke those separate shares.

The profile exposes resolved Tender and Operations write decisions to the UI. This reuses existing permission resolution and does not grant new billing or publishing capabilities. Department access queries are batched. Permission administration remains limited to administrators and heads of their own department; the UI displays the CEO's effective company access accurately.

## Dependencies and checks

Existing dependencies received security updates. SheetJS is pinned to the official `0.20.3` distribution in both applications because the npm registry release is outdated ([upstream installation instructions](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)). Nodemailer is pinned to `10.0.16`; its current release requires Node.js 20 or newer ([upstream changelog](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md)). Installs were performed with lifecycle scripts disabled; no database migration or seed command ran.

The frontend dependency audit and backend production audit report zero findings. A targeted override pins Prisma's configuration dependency `deepmerge-ts` to `8.0.2`, addressing the [recursive-graph advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx). Prisma and its client remain on `6.19.3`. Configuration loading, plain-object merging, recursive input handling and Prisma schema validation passed with the override. Recheck its compatibility when upgrading Prisma. The full backend audit still reports 20 moderate development-tooling entries; a forced toolchain change was not applied.

All 134 regression tests pass with `npm test -- --runInBand`. Verification includes builds and TypeScript checks for both applications, scoped lint checks, spreadsheet round trips and email rendering without SMTP delivery. Browser checks cover registration, submission confirmation, shared-record editing, read-only controls, CEO review filters, board-pack eligibility and desktop/mobile layouts. They use mocked API responses and do not validate a live database or production response times. Frontend lint retains existing Fast Refresh warnings in the authentication module.

## Remaining rollout work

No new database schema change is required for this phase. The earlier `20261008120000_work_completion_dates` migration still needs the deployment process described in the backend README if it has not been applied.

Before production rollout, validate the new Prisma queries against a staging database with real department assignments and sharing rules. Measure query plans and response times using representative data. The historical reports inbox and the merged document library still fetch their matching records before application-level pagination; the existing analytics views also retain broad data queries. Database pagination for these historical views and bundle splitting for legacy analytics remain follow-up performance work.
