import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { AiService } from "./ai.service";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Database assistant tool execution", () => {
  it("executes a requested query, supplies its result, and returns plain text without asterisks", async () => {
    const request = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "function_call",
                name: "query_records",
                call_id: "query-1",
                arguments: '{"model":"Expense"}',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "**Across all dates**, 50 expenses total **KES 5000**.",
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      );
    const execute = jest.fn(async (_name: string, _args: unknown) => ({
      data: { count: 50, total: 5000 },
    }));
    const result = await new AiService(
      new ConfigService({ OPENAI_API_KEY: "test-only-key", OPENAI_MODEL: "gpt-4o" }),
    ).withTools(
      { system: "Use database facts", prompt: "Show all expenses" },
      [
        {
          name: "query_records",
          description: "Read records",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
      execute,
    );
    expect(execute).toHaveBeenCalledWith("query_records", { model: "Expense" });
    expect(result.text).toBe("Across all dates, 50 expenses total KES 5000.");
    const second = JSON.parse(String(request.mock.calls[1][1]?.body)) as {
      input: { type?: string; output?: string }[];
      store: boolean;
    };
    expect(second.store).toBe(false);
    expect(second.input).toContainEqual(
      expect.objectContaining({
        type: "function_call_output",
        output: '{"count":50,"total":5000}',
      }),
    );
  });

  it("surfaces incomplete provider responses instead of presenting a partial answer as complete", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "incomplete", output: [] }), { status: 200 }),
      );
    await expect(
      new AiService(new ConfigService({ OPENAI_API_KEY: "test-only-key" })).withTools(
        { system: "Read records", prompt: "All history" },
        [],
        async () => ({ data: {} }),
      ),
    ).rejects.toThrow("did not finish");
  });
});
