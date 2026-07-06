import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { JsonLedgerClient } from "@meridian/ledger-client";
import type { AgentLoop } from "./agent-loop.js";

export function startAgentHttpServer(params: {
  port: number;
  loop: AgentLoop;
  getClient: () => Promise<JsonLedgerClient>;
}): ReturnType<typeof createServer> {
  const server = createServer(async (req, res) => {
    await handleRequest(req, res, params);
  });
  server.listen(params.port, () => {
    console.log(`agent-runtime http listening port=${params.port}`);
  });
  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  params: {
    loop: AgentLoop;
    getClient: () => Promise<JsonLedgerClient>;
  }
): Promise<void> {
  const url = req.url?.split("?")[0] ?? "/";
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && url === "/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url === "/status") {
      console.log("[agent-runtime] GET /status");
      json(res, 200, params.loop.getStatus());
      return;
    }

    if (req.method === "POST" && url === "/tick") {
      console.log("[agent-runtime] POST /tick — starting Groq + ledger tick");
      const client = await params.getClient();
      const status = await params.loop.runTick(client);
      json(res, 200, status);
      return;
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: String(err), status: params.loop.getStatus() });
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
