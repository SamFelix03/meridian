import Fastify from "fastify";
import type { KybVerifyRequest } from "@meridian/shared-types";
import { createDefaultService, KybGatewayError } from "./service.js";

const PORT = Number(process.env.KYB_GATEWAY_PORT ?? 8090);
const DATA_DIR = process.env.KYB_DATA_DIR ?? "./data";
const COMPLETE_SECRET = process.env.KYB_COMPLETE_SECRET ?? "dev-kyb-secret";

const service = createDefaultService(DATA_DIR);

const app = Fastify({ logger: true });

function requireCompleteAuth(authHeader: string | undefined): void {
  if (!authHeader || authHeader !== `Bearer ${COMPLETE_SECRET}`) {
    throw new KybGatewayError("UNAUTHORIZED", "missing or invalid KYB complete authorization");
  }
}

app.get("/health", async () => ({ status: "ok", service: "kyb-gateway" }));

app.post<{ Body: KybVerifyRequest }>("/v1/kyb/verify", async (req) => {
  return service.verify(req.body);
});

app.get<{ Params: { verificationId: string } }>(
  "/v1/kyb/verify/:verificationId",
  async (req) => {
    const status = service.getStatus(req.params.verificationId);
    if (!status) {
      return { status: "NOT_FOUND", valid: false };
    }
    return { ...status, valid: status.status === "APPROVED" };
  }
);

app.post<{
  Params: { verificationId: string };
  Body: { decision: "APPROVED" | "REJECTED"; reason?: string };
}>(
  "/v1/kyb/verify/:verificationId/complete",
  async (req, reply) => {
    try {
      requireCompleteAuth(req.headers.authorization);
      const result = service.complete(
        req.params.verificationId,
        req.body.decision,
        req.body.reason
      );
      return result;
    } catch (err) {
      if (err instanceof KybGatewayError) {
        const code = err.code === "UNAUTHORIZED" ? 401 : err.code === "NOT_FOUND" ? 404 : 400;
        return reply.status(code).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }
);

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  console.error(err);
  process.exit(1);
});
