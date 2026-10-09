# Project cleanup

The cleanup removed 33 unreachable frontend source files and 6,210 source lines, including
dead declarations in retained files. It also removed 22 unused direct frontend dependencies
and two backend dependencies. Remaining dependency versions and npm scripts are unchanged.

Files were checked against imports, re-exports, dynamic imports, TypeScript symbol references,
all TanStack route files, Nest module registrations, tests and operational scripts.

## Removed files

All paths below are relative to `frontend/src`.

| Group                      | Files                                                                                                                                                                                                                                                                                                                                                                             | Reason                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Old project workspace tabs | `components/project-workspace/calendar-tab.tsx`, `financials-tab.tsx`, `gantt-tab.tsx`, `raid-tab.tsx`, `team-tab.tsx`, `workspace-header.tsx`                                                                                                                                                                                                                                    | The current shared project workspace does not import these tabs.             |
| Old project views          | `features/hr/hr-project-overview.tsx`, `features/projects/project-financials.tsx`, `features/projects/project-timeline.tsx`                                                                                                                                                                                                                                                       | Current project routes use the shared workspace and existing pipeline views. |
| Orphaned utilities         | `features/project-workspace/workspace-calcs.ts`, `hooks/use-mobile.tsx`                                                                                                                                                                                                                                                                                                           | Their only consumers were removed code.                                      |
| Unused UI wrappers         | `components/ui/alert.tsx`, `aspect-ratio.tsx`, `avatar.tsx`, `breadcrumb.tsx`, `card.tsx`, `carousel.tsx`, `chart.tsx`, `collapsible.tsx`, `context-menu.tsx`, `drawer.tsx`, `form.tsx`, `hover-card.tsx`, `input-otp.tsx`, `menubar.tsx`, `navigation-menu.tsx`, `pagination.tsx`, `resizable.tsx`, `sidebar.tsx`, `slider.tsx`, `toggle-group.tsx`, `toggle.tsx`, `tooltip.tsx` | No current route or reachable component imports these wrappers.              |

## Trimmed code

- Removed the unused `OverviewTab`, donut and timeline panels; retained the active SDLC panel.
- Removed orphaned cost-item, RACI and RAID frontend hooks and types; retained team hooks.
- Removed unused department report mutation hooks and duplicate formatting helpers; retained
  report pickers, the CEO inbox and email subscription hooks.
- Removed uncalled hooks, placeholder components, constants and imports in other active files.
- Removed the uncalled report access and storage status helpers and the ignored `checkRole` option from project
  access helpers and their callers. Existing permission checks and regression assertions remain.
- Enabled unused-variable lint warnings and removed the deleted chart wrapper's HTML exception.

## Dependency removals

Frontend: `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@hookform/resolvers`,
`@radix-ui/react-aspect-ratio`, `@radix-ui/react-avatar`, `@radix-ui/react-collapsible`,
`@radix-ui/react-context-menu`, `@radix-ui/react-hover-card`, `@radix-ui/react-menubar`,
`@radix-ui/react-navigation-menu`, `@radix-ui/react-slider`, `@radix-ui/react-toggle`,
`@radix-ui/react-toggle-group`, `@radix-ui/react-tooltip`, `@tanstack/router-plugin`, `cmdk`,
`date-fns`, `embla-carousel-react`, `input-otp`, `react-hook-form`, `react-resizable-panels`, `vaul`.

Backend: `uuid`, `@nestjs/testing`.

Required transitive packages and framework peer dependencies remain installed. Both lockfiles
were updated without installing new packages or changing remaining package versions.

## Preserved functionality

Water and blog source files are unchanged. Routes, server entry points, API controllers,
database schema, migrations, seed scripts, public assets and project documentation remain.
Lazy-loaded PDF, Word and board pack exports remain active. Registered endpoints are retained
even when the current frontend has no caller.

## Validation

- Frontend and backend TypeScript checks passed.
- Both production builds passed, including the frontend output-integrity check.
- Backend regression suite: 134 tests across 15 suites passed.
- The import graph found no remaining unreachable source files.
- Frontend lint: no errors; 42 warnings, principally existing Fast Refresh warnings, plus
  unused-variable warnings in the excluded Water module.
- Full backend lint still reports two existing `no-explicit-any` errors in
  `src/common/pagination.ts`. The file is unchanged from the pre-cleanup copy.

No database commands, production changes or commits were made.
