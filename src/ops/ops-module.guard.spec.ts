import "reflect-metadata";
import { describe, expect, it } from "@jest/globals";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { OpsFeature, OpsFeatureRead, OpsModuleGuard } from "./ops-module.guard";

@OpsFeature("water")
class WaterProbe {
  read() {}
  write() {}
  @OpsFeatureRead() chat() {}
}
@OpsFeature("ledger")
class LedgerProbe {
  read() {}
  write() {}
}
@OpsFeature("blog")
class BlogProbe {
  read() {}
}

function probe(
  modules: Record<string, string>,
  method = "GET",
  handler = WaterProbe.prototype.read,
  controller: typeof WaterProbe | typeof BlogProbe | typeof LedgerProbe = WaterProbe,
) {
  const request = {
    method,
    opsViewer: {
      id: "ops-id",
      userId: "legacy-id",
      email: "staff@example.test",
      role: "ceo",
      modules,
    },
    user: undefined as unknown,
  };
  const context = {
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: () => undefined }),
    }),
  } as unknown as ExecutionContext;
  return { request, run: () => new OpsModuleGuard(new Reflector()).canActivate(context) };
}

describe("Individual Ops module permissions", () => {
  it("denies an unassigned CEO and keeps module grants separate", () => {
    expect(probe({}).run).toThrow(ForbiddenException);
    expect(probe({ water: "manage" }, "GET", BlogProbe.prototype.read, BlogProbe).run).toThrow(
      ForbiddenException,
    );
  });
  it("allows reads and maps authorship to the linked legacy identity", () => {
    const check = probe({ water: "view" });
    expect(check.run()).toBe(true);
    expect(check.request.user).toEqual({
      id: "legacy-id",
      email: "staff@example.test",
      roles: ["water"],
      departmentId: null,
    });
  });
  it("denies writes and downloads after revocation, and permits managers", () => {
    expect(probe({ water: "view" }, "POST", WaterProbe.prototype.write).run).toThrow(
      ForbiddenException,
    );
    expect(probe({}, "GET").run).toThrow(ForbiddenException);
    expect(probe({ water: "manage" }, "DELETE", WaterProbe.prototype.write).run()).toBe(true);
  });
  it("enforces Ledger grants without legacy administrator roles", () => {
    expect(probe({}, "GET", LedgerProbe.prototype.read, LedgerProbe).run).toThrow(
      ForbiddenException,
    );
    expect(probe({ ledger: "view" }, "POST", LedgerProbe.prototype.write, LedgerProbe).run).toThrow(
      ForbiddenException,
    );
    const check = probe({ ledger: "manage" }, "POST", LedgerProbe.prototype.write, LedgerProbe);
    expect(check.run()).toBe(true);
    expect(check.request.user).toEqual({
      id: "legacy-id",
      email: "staff@example.test",
      roles: [],
      departmentId: null,
    });
  });
  it("allows explicitly read-only assistant actions for viewers", () => {
    expect(probe({ water: "view" }, "POST", WaterProbe.prototype.chat).run()).toBe(true);
  });
});
