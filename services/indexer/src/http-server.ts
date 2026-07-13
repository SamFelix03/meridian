import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ProjectionStore } from "./projection-store.js";

export interface IndexerHttpConfig {
  port: number;
  orgId: string;
  role: "Supplier" | "Buyer" | "Financier" | "Regulator" | "PlatformOperator";
  actingParty?: string;
  /** SOFR reference rate as decimal (e.g. 0.0366). */
  sofrReferenceRate?: number;
  oracleMaxAgeMs?: number;
}

function supplierRouteParam(url: string, prefix: string): string | null {
  const path = url.split("?")[0] ?? url;
  const parts = path.split("/").filter(Boolean);
  // /supplier/bids/:requestId or /supplier/bid-comparison/:requestId
  if (parts[0] !== "supplier" || parts[1] !== prefix || !parts[2]) return null;
  return decodeURIComponent(parts[2]);
}

export function startIndexerHttpServer(
  store: ProjectionStore,
  config: IndexerHttpConfig
): ReturnType<typeof createServer> {
  const server = createServer(async (req, res) => {
    await handleRequest(req, res, store, config);
  });
  server.listen(config.port, () => {
    console.log(
      `indexer http listening org=${config.orgId} role=${config.role} port=${config.port}`
    );
  });
  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: ProjectionStore,
  config: IndexerHttpConfig
): Promise<void> {
  const url = req.url ?? "/";
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "GET") {
    json(res, 405, { error: "method not allowed" });
    return;
  }

  const sofrReferenceRate =
    config.sofrReferenceRate ??
    Number(process.env.MERIDIAN_SOFR_REFERENCE_RATE ?? "0.0366");
  const oracleMaxAgeMs =
    config.oracleMaxAgeMs ??
    Number(process.env.MERIDIAN_ORACLE_MAX_AGE_MS ?? "300000");

  try {
    if (url === "/health") {
      json(res, 200, { ok: true, orgId: config.orgId });
      return;
    }

    if (config.role === "Buyer" && url === "/buyer/obligations") {
      json(res, 200, { obligations: store.getBuyerObligations() });
      return;
    }

    if (config.role === "Buyer" && url === "/buyer/pending-proposals") {
      json(res, 200, { proposals: store.getPendingProposals() });
      return;
    }

    if (config.role === "Supplier" && url === "/supplier/receivables") {
      json(res, 200, { receivables: store.getSupplierReceivables() });
      return;
    }

    if (config.role === "Supplier" && url === "/supplier/consent-policies") {
      json(res, 200, { policies: store.getConsentPolicies() });
      return;
    }

    if (config.role === "Supplier" && url === "/supplier/pending-proposals") {
      json(res, 200, { proposals: store.getPendingProposals() });
      return;
    }

    if (config.role === "Supplier" && url === "/supplier/financing-rounds") {
      json(res, 200, { rounds: store.getFinancingRounds() });
      return;
    }

    const bidsRequestId = supplierRouteParam(url, "bids");
    if (config.role === "Supplier" && bidsRequestId) {
      json(res, 200, { bids: store.getBidsForRequestContract(bidsRequestId) });
      return;
    }

    const comparisonRequestId = supplierRouteParam(url, "bid-comparison");
    if (config.role === "Supplier" && comparisonRequestId) {
      json(res, 200, {
        bids: store.getBidComparison(comparisonRequestId, {
          referenceRate: sofrReferenceRate,
          maxAgeMs: oracleMaxAgeMs,
        }),
      });
      return;
    }

    if (config.role === "Buyer" && url === "/buyer/repayable-obligations") {
      json(res, 200, { obligations: store.getBuyerRepayableObligations() });
      return;
    }

    if (config.role === "Supplier" && url === "/supplier/portfolio") {
      json(res, 200, store.getSupplierPortfolio());
      return;
    }

    // Allow portal-api to query financier positions from the supplier indexer,
    // since the financier is not an observer on Receivable contracts.
    const financierPositionsParty = (() => {
      const parts = url.split("?")[0]?.split("/").filter(Boolean) ?? [];
      if (
        config.role === "Supplier" &&
        parts[0] === "financier" &&
        parts[1] === "positions" &&
        parts[2]
      ) {
        return decodeURIComponent(parts[2]);
      }
      return null;
    })();
    if (financierPositionsParty) {
      json(res, 200, {
        positions: store.getFinancierPositions(financierPositionsParty),
      });
      return;
    }

    if (config.role === "Financier" && url === "/financier/positions") {
      json(res, 200, {
        positions: store.getFinancierPositions(config.actingParty ?? ""),
      });
      return;
    }

    if (config.role === "Financier" && url === "/financier/invitations") {
      json(res, 200, { invitations: store.getFinancierInvitations() });
      return;
    }

    if (config.role === "Financier" && url === "/financier/my-bids") {
      json(res, 200, {
        bids: store.getFinancierMyBids(config.actingParty ?? ""),
      });
      return;
    }

    if (config.role === "Financier" && url === "/financier/mandates") {
      json(res, 200, {
        mandates: store.getFinancierMandates(config.actingParty ?? ""),
      });
      return;
    }

    if (config.role === "Financier" && url === "/financier/syndication/offerings") {
      json(res, 200, { offerings: store.getSyndicationOfferings() });
      return;
    }

    if (config.role === "Financier" && url === "/financier/syndication/invitations") {
      json(res, 200, {
        invitations: store.getSyndicationInvitations(config.actingParty ?? ""),
      });
      return;
    }

    if (config.role === "Financier" && url === "/financier/syndication/my-interests") {
      json(res, 200, {
        interests: store.getParticipationInterests(config.actingParty ?? ""),
      });
      return;
    }

    const capTableMatch = url.match(/^\/financier\/syndication\/cap-table\/([^/]+)$/);
    if (config.role === "Financier" && capTableMatch) {
      const receivableId = decodeURIComponent(capTableMatch[1] ?? "");
      const capTable = store.getLeadCapTable(receivableId);
      if (!capTable) {
        json(res, 404, { error: "cap table not found" });
        return;
      }
      json(res, 200, capTable);
      return;
    }

    const syndicationBidsMatch = url.match(/^\/financier\/syndication\/bids\/([^/]+)$/);
    if (config.role === "Financier" && syndicationBidsMatch) {
      const offeringId = decodeURIComponent(syndicationBidsMatch[1] ?? "");
      json(res, 200, {
        bids: store.getSyndicationBidsForOffering(offeringId),
      });
      return;
    }

    if (config.role === "Regulator" && url.startsWith("/regulator/exposure")) {
      const parsed = new URL(url, "http://localhost");
      const jurisdiction = parsed.searchParams.get("jurisdiction") ?? undefined;
      json(res, 200, {
        rows: store.getRegulatorExposureRows(jurisdiction),
        rollups: store.getRegulatorExposureRollups(jurisdiction),
      });
      return;
    }

    if (config.role === "PlatformOperator" && url === "/ops/settlement-finality") {
      json(res, 200, {
        summary: store.getSettlementFinalitySummary(),
        audits: store.getSettlementAudits(),
      });
      return;
    }

    if (config.role === "PlatformOperator" && url === "/ops/regulator-grants") {
      json(res, 200, { grants: store.getRegulatorGrants() });
      return;
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: String(err) });
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
