import { createServer as tcpServer } from "node:net";
import { createServer as httpServer } from "node:http";

export async function startWeeklyEmailFixture() {
  const messages: { recipients: string[]; raw: string }[] = [];
  let failing = false;
  let runSchedule: (() => Promise<void>) | undefined;
  let resetWeekly: (() => Promise<void>) | undefined;
  const smtp = tcpServer((socket) => {
    socket.write("220 ops-weekly-fixture ESMTP\r\n");
    let buffer = "";
    let data = false;
    let body: string[] = [];
    let recipients: string[] = [];
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes("\r\n")) {
        const index = buffer.indexOf("\r\n");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data) {
          if (line === ".") {
            data = false;
            if (!failing) messages.push({ recipients: [...recipients], raw: body.join("\r\n") });
            socket.write(
              failing ? "451 Fixture delivery unavailable\r\n" : "250 Fixture accepted\r\n",
            );
            body = [];
          } else body.push(line.replace(/^\.\./, "."));
        } else if (/^(EHLO|HELO)/i.test(line))
          socket.write("250-ops-weekly-fixture\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH/i.test(line)) socket.write("235 Authentication accepted\r\n");
        else if (/^MAIL FROM:/i.test(line)) {
          recipients = [];
          socket.write("250 Sender accepted\r\n");
        } else if (/^RCPT TO:/i.test(line)) {
          recipients.push(line.slice(8).trim());
          socket.write("250 Recipient accepted\r\n");
        } else if (/^DATA$/i.test(line)) {
          data = true;
          socket.write("354 End with a dot\r\n");
        } else if (/^QUIT$/i.test(line)) socket.end("221 Goodbye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  const control = httpServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("Content-Type", "application/json");
    try {
      if (req.method === "POST" && req.url === "/fail") failing = JSON.parse(raw).fail === true;
      if (req.method === "POST" && req.url === "/tick") await runSchedule?.();
      if (req.method === "POST" && req.url === "/reset") {
        await resetWeekly?.();
        messages.length = 0;
        failing = false;
      }
      res.end(JSON.stringify({ messages, failing }));
    } catch {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Fixture request failed" }));
    }
  });
  for (const [server, port] of [
    [smtp, 2526],
    [control, 2527],
  ] as const)
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  return {
    setReset: (reset: () => Promise<void>) => {
      resetWeekly = reset;
    },
    setScheduler: (run: () => Promise<void>) => {
      runSchedule = run;
    },
    close: async () => {
      for (const server of [control, smtp])
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    },
  };
}
