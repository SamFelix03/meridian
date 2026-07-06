import { createHash, randomUUID } from "node:crypto";
import type { RawLedgerEvent, IndexerCheckpoint } from "@meridian/shared-types";

export * from "./commands.js";
export * from "./cip56.js";
export * from "./cash-settlement.js";
export * from "./syndication-settlement.js";
export * from "./contract-resolve.js";

export interface JsonLedgerClientConfig {
  baseUrl: string;
  bearerToken?: string;
  actingParty?: string;
}

export interface ActiveContract {
  contractId: string;
  templateId: string;
  payload: unknown;
  createdEventBlob?: string;
}

export interface InterfaceActiveContract extends ActiveContract {
  interfaceViews: Array<{ interfaceId: string; viewValue: unknown }>;
}

export interface SubmitAndWaitResult {
  transaction?: {
    updateId?: string;
    events?: unknown[];
  };
}

export interface LedgerUpdate {
  offset: string;
  updateId: string;
  recordTime: string;
  events: unknown[];
}

export interface GetUpdatesResult {
  updates: LedgerUpdate[];
  endOffset: string;
}

interface ParsedTransaction {
  updateId: string;
  recordTime: string;
  events: unknown[];
  offset: string;
}

/** Seaport JSON API wraps Transaction/OffsetCheckpoint payloads in `{ value: ... }`. */
export function unwrapTransaction(raw: unknown): ParsedTransaction | null {
  if (!raw || typeof raw !== "object") return null;
  const wrapper = raw as Record<string, unknown>;
  const tx = (wrapper.value as Record<string, unknown> | undefined) ?? wrapper;
  const events = Array.isArray(tx.events) ? tx.events : [];
  const updateId = String(tx.updateId ?? "");
  const recordTime = String(tx.recordTime ?? tx.effectiveAt ?? "");
  const offset = String(tx.offset ?? "");
  if (!updateId && events.length === 0) return null;
  return { updateId, recordTime, events, offset };
}

export function unwrapOffsetCheckpoint(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const wrapper = raw as Record<string, unknown>;
  const cp = (wrapper.value as Record<string, unknown> | undefined) ?? wrapper;
  return cp.offset != null ? String(cp.offset) : null;
}

/** Seaport JSON API may wrap event payloads in `{ value: ... }`. */
function unwrapEventPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  return (obj.value as Record<string, unknown> | undefined) ?? obj;
}

/** Extract a created contract id; when templateHint is set, prefer matching templateId. */
export function extractCreatedContractId(
  result: { transaction?: { events?: unknown[] } },
  templateHint?: string
): string | null {
  let fallback: string | null = null;
  for (const ev of result.transaction?.events ?? []) {
    if (!ev || typeof ev !== "object") continue;
    const obj = ev as Record<string, unknown>;
    const createdRaw = obj.CreatedEvent ?? obj.createdEvent;
    const created = unwrapEventPayload(createdRaw);
    if (!created?.contractId) continue;
    const contractId = String(created.contractId);
    if (!fallback) fallback = contractId;
    const templateId = String(created.templateId ?? "");
    if (templateHint && templateId.includes(templateHint)) {
      return contractId;
    }
  }
  return fallback;
}

/** JSON Ledger API v2 client for Phase 0 topology and indexer replay. */
export class JsonLedgerClient {
  private cachedUserId?: string;

  constructor(private config: JsonLedgerClientConfig) {}

  /** Resolve the ledger user id for command submission (cached after first call). */
  async getAuthenticatedUserId(): Promise<string> {
    if (this.cachedUserId) return this.cachedUserId;
    if (!this.config.bearerToken) {
      this.cachedUserId = "meridian-portal";
      return this.cachedUserId;
    }
    const res = await fetch(`${this.config.baseUrl}/v2/authenticated-user`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new LedgerClientError("AUTHENTICATED_USER_FAILED", await res.text());
    }
    const body = (await res.json()) as {
      user?: { id?: string; userId?: string };
    };
    const userId = body.user?.id ?? body.user?.userId;
    if (!userId) {
      throw new LedgerClientError(
        "AUTHENTICATED_USER_FAILED",
        "missing user id in response"
      );
    }
    this.cachedUserId = userId;
    return userId;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.bearerToken) {
      h["Authorization"] = `Bearer ${this.config.bearerToken}`;
    }
    return h;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/v2/version`, {
        headers: this.headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listParties(): Promise<string[]> {
    const res = await fetch(`${this.config.baseUrl}/v2/parties`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new LedgerClientError("LIST_PARTIES_FAILED", await res.text());
    }
    const body = (await res.json()) as { partyDetails?: Array<{ party: string }> };
    return (body.partyDetails ?? []).map((p) => p.party);
  }

  async getParty(partyId: string): Promise<boolean> {
    const res = await fetch(
      `${this.config.baseUrl}/v2/parties/${encodeURIComponent(partyId)}`,
      { headers: this.headers() }
    );
    if (res.status === 404) return false;
    if (!res.ok) {
      throw new LedgerClientError("GET_PARTY_FAILED", await res.text());
    }
    const body = (await res.json()) as { partyDetails?: Array<{ party: string }> };
    return (body.partyDetails ?? []).some((p) => p.party === partyId);
  }

  async getActiveContracts(party: string): Promise<ActiveContract[]> {
    const activeAtOffset = await this.getLedgerEnd();
    const res = await fetch(`${this.config.baseUrl}/v2/state/active-contracts`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        filter: {
          filtersByParty: {
            [party]: {
              cumulative: [],
            },
          },
        },
        activeAtOffset,
      }),
    });
    if (!res.ok) {
      throw new LedgerClientError("GET_ACS_FAILED", await res.text());
    }
    const entries = (await res.json()) as Array<{
      contractEntry?: {
        JsActiveContract?: {
          createdEvent?: {
            contractId: string;
            templateId: string;
            createArgument: unknown;
          };
        };
      };
    }>;
    return entries
      .map((e) => e.contractEntry?.JsActiveContract?.createdEvent)
      .filter(Boolean)
      .map((ev) => ({
        contractId: ev!.contractId,
        templateId: ev!.templateId,
        payload: ev!.createArgument,
      }));
  }

  async getUpdates(params: {
    party: string;
    beginExclusive?: string;
  }): Promise<GetUpdatesResult> {
    const beginExclusive =
      params.beginExclusive && params.beginExclusive !== ""
        ? params.beginExclusive
        : await this.getLedgerEnd();
    const res = await fetch(`${this.config.baseUrl}/v2/updates`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        beginExclusive,
        updateFormat: {
          includeTransactions: {
            transactionShape: "TRANSACTION_SHAPE_ACS_DELTA",
            eventFormat: {
              filtersByParty: {
                [params.party]: { cumulative: [] },
              },
              verbose: false,
            },
          },
        },
      }),
    });
    if (!res.ok) {
      throw new LedgerClientError("GET_UPDATES_FAILED", await res.text());
    }
    const body = (await res.json()) as Array<{
      update?: {
        OffsetCheckpoint?: { offset: string };
        Transaction?: {
          updateId: string;
          recordTime: string;
          events: unknown[];
        };
      };
    }>;
    const updates: LedgerUpdate[] = [];
    let lastTxOffset: string | null = null;
    let checkpointOffset: string | null = null;
    for (const item of body) {
      const cp = unwrapOffsetCheckpoint(item.update?.OffsetCheckpoint);
      if (cp) checkpointOffset = cp;
      const tx = unwrapTransaction(item.update?.Transaction);
      if (tx) {
        const offset = tx.offset || cp || beginExclusive;
        lastTxOffset = offset;
        updates.push({
          offset,
          updateId: tx.updateId,
          recordTime: tx.recordTime,
          events: tx.events,
        });
      }
    }
    const endOffset =
      lastTxOffset ??
      (checkpointOffset && checkpointOffset !== beginExclusive
        ? checkpointOffset
        : beginExclusive);
    return { updates, endOffset: String(endOffset) };
  }

  async allocateParty(partyHint: string, displayName?: string): Promise<string> {
    const res = await fetch(`${this.config.baseUrl}/v2/parties`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        partyIdHint: partyHint,
        displayName: displayName ?? partyHint,
        identityProviderId: "",
      }),
    });
    if (!res.ok) {
      throw new LedgerClientError("ALLOCATE_PARTY_FAILED", await res.text());
    }
    const body = (await res.json()) as { partyDetails?: { party: string } };
    const party = body.partyDetails?.party;
    if (!party) {
      throw new LedgerClientError("ALLOCATE_PARTY_FAILED", "No party in response");
    }
    return party;
  }

  async getLedgerEnd(): Promise<string> {
    const res = await fetch(`${this.config.baseUrl}/v2/state/ledger-end`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new LedgerClientError("GET_LEDGER_END_FAILED", await res.text());
    }
    const body = (await res.json()) as { offset?: string | number };
    return body.offset != null ? String(body.offset) : "";
  }

  async listPackages(): Promise<string[]> {
    const res = await fetch(`${this.config.baseUrl}/v2/packages`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new LedgerClientError("LIST_PACKAGES_FAILED", await res.text());
    }
    const body = (await res.json()) as { packageIds?: string[] };
    return body.packageIds ?? [];
  }

  async uploadDar(darBytes: Buffer | Uint8Array): Promise<void> {
    const res = await fetch(`${this.config.baseUrl}/v2/packages`, {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": "application/octet-stream",
      },
      body: darBytes,
    });
    if (!res.ok) {
      throw new LedgerClientError("UPLOAD_DAR_FAILED", await res.text());
    }
  }

  async submitAndWaitForTransaction(params: {
    actAs: string[];
    readAs?: string[];
    commands: unknown[];
    commandId?: string;
    userId?: string;
  }): Promise<SubmitAndWaitResult> {
    const userId = params.userId ?? (await this.getAuthenticatedUserId());
    const res = await fetch(
      `${this.config.baseUrl}/v2/commands/submit-and-wait-for-transaction`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          commands: {
            actAs: params.actAs,
            readAs: params.readAs ?? params.actAs,
            userId,
            commandId: params.commandId ?? randomUUID(),
            commands: params.commands,
          },
        }),
      }
    );
    if (!res.ok) {
      throw new LedgerClientError("SUBMIT_FAILED", await res.text());
    }
    return (await res.json()) as SubmitAndWaitResult;
  }

  async getActiveContractsByInterface(
    party: string,
    interfaceId: string
  ): Promise<InterfaceActiveContract[]> {
    const activeAtOffset = await this.getLedgerEnd();
    const res = await fetch(`${this.config.baseUrl}/v2/state/active-contracts`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        filter: {
          filtersByParty: {
            [party]: {
              cumulative: [
                {
                  identifierFilter: {
                    InterfaceFilter: {
                      value: {
                        interfaceId,
                        includeInterfaceView: true,
                      },
                    },
                  },
                },
              ],
            },
          },
        },
        activeAtOffset,
      }),
    });
    if (!res.ok) {
      throw new LedgerClientError("GET_ACS_INTERFACE_FAILED", await res.text());
    }
    const entries = (await res.json()) as Array<{
      contractEntry?: {
        JsActiveContract?: {
          createdEvent?: {
            contractId: string;
            templateId: string;
            createArgument?: unknown;
            interfaceViews?: Array<{
              interfaceId: string;
              viewValue: unknown;
            }>;
          };
        };
      };
    }>;
    return entries
      .map((e) => e.contractEntry?.JsActiveContract?.createdEvent)
      .filter(Boolean)
      .map((ev) => ({
        contractId: ev!.contractId,
        templateId: ev!.templateId,
        payload: ev!.createArgument,
        interfaceViews: ev!.interfaceViews ?? [],
      }));
  }

  async getActiveContractsByTemplate(
    party: string,
    templateId: string
  ): Promise<ActiveContract[]> {
    const activeAtOffset = await this.getLedgerEnd();
    const res = await fetch(`${this.config.baseUrl}/v2/state/active-contracts`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        filter: {
          filtersByParty: {
            [party]: {
              cumulative: [
                {
                  identifierFilter: {
                    TemplateFilter: {
                      value: {
                        templateId,
                        includeCreatedEventBlob: false,
                      },
                    },
                  },
                },
              ],
            },
          },
        },
        activeAtOffset,
      }),
    });
    if (!res.ok) {
      throw new LedgerClientError("GET_ACS_TEMPLATE_FAILED", await res.text());
    }
    const entries = (await res.json()) as Array<{
      contractEntry?: {
        JsActiveContract?: {
          createdEvent?: {
            contractId: string;
            templateId: string;
            createArgument: unknown;
          };
        };
      };
    }>;
    return entries
      .map((e) => e.contractEntry?.JsActiveContract?.createdEvent)
      .filter(Boolean)
      .map((ev) => ({
        contractId: ev!.contractId,
        templateId: ev!.templateId,
        payload: ev!.createArgument,
      }));
  }
}

export class LedgerClientError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "LedgerClientError";
  }
}

/** gRPC Ledger API v2 client wrapper (Phase 0: connection + health). */
export class GrpcLedgerClient {
  constructor(
    private host: string,
    private port: number
  ) {}

  endpoint(): string {
    return `${this.host}:${this.port}`;
  }

  /** Validates gRPC endpoint is reachable via TCP (full proto client wired at integration). */
  async isReachable(): Promise<boolean> {
    const net = await import("node:net");
    return new Promise((resolve) => {
      const socket = net.createConnection(
        { host: this.host, port: this.port, timeout: 3000 },
        () => {
          socket.destroy();
          resolve(true);
        }
      );
      socket.on("error", () => resolve(false));
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
  }
}

/** Seaport DevNet topology client — allocates parties on shared 5North validator. */
export class SeaportTopologyClient {
  constructor(
    private client: JsonLedgerClient,
    private validatorId = "seaport-devnet"
  ) {}

  static create(client: JsonLedgerClient, validatorId?: string): SeaportTopologyClient {
    return new SeaportTopologyClient(client, validatorId);
  }

  async allocateParty(params: {
    partyHint: string;
    displayName: string;
  }): Promise<{ partyId: string; topologyTxId: string }> {
    let partyId: string;
    try {
      partyId = await this.client.allocateParty(params.partyHint, params.displayName);
    } catch (err) {
      if (err instanceof LedgerClientError && err.code === "ALLOCATE_PARTY_FAILED") {
        const existing = await this.findPartyByHint(params.partyHint);
        if (existing) {
          partyId = existing;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    const topologyTxId = createHash("sha256")
      .update(`${partyId}:${this.validatorId}:${randomUUID()}`)
      .digest("hex")
      .slice(0, 32);

    return { partyId, topologyTxId };
  }

  async findPartyByHint(partyHint: string): Promise<string | null> {
    try {
      const parties = await this.client.listParties();
      return parties.find((p) => p.startsWith(`${partyHint}::`)) ?? null;
    } catch {
      return null;
    }
  }

  async verifyParty(partyId: string): Promise<boolean> {
    return this.client.getParty(partyId);
  }

  async getLedgerEnd(): Promise<string> {
    return this.client.getLedgerEnd();
  }

  async uploadDarFromFile(darPath: string): Promise<void> {
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(darPath);
    await this.client.uploadDar(bytes);
  }

  async listPackages(): Promise<string[]> {
    return this.client.listPackages();
  }

  async healthCheck(): Promise<boolean> {
    return this.client.healthCheck();
  }
}

/** @deprecated LocalNet-only — use SeaportTopologyClient on DevNet. */
export class CantonTopologyClient {
  async allocateParty(params: {
    participantHost: string;
    ledgerPort: number;
    jsonApiPort?: number;
    partyHint: string;
    synchronizerIds: string[];
  }): Promise<{ partyId: string; topologyTxId: string }> {
    const jsonPort = params.jsonApiPort ?? params.ledgerPort + 74;
    const client = new JsonLedgerClient({
      baseUrl: `http://${params.participantHost}:${jsonPort}`,
    });

    const partyId = await client.allocateParty(params.partyHint);
    const topologyTxId = createHash("sha256")
      .update(`${partyId}:${params.synchronizerIds.join(",")}:${randomUUID()}`)
      .digest("hex")
      .slice(0, 32);

    return { partyId, topologyTxId };
  }

  async verifySynchronizerConnections(params: {
    participantHost: string;
    jsonApiPort: number;
    expectedCount: number;
  }): Promise<{ connected: boolean; partyCount: number }> {
    const client = new JsonLedgerClient({
      baseUrl: `http://${params.participantHost}:${params.jsonApiPort}`,
    });
    const healthy = await client.healthCheck();
    if (!healthy) {
      return { connected: false, partyCount: 0 };
    }
    const parties = await client.listParties();
    return {
      connected: healthy,
      partyCount: parties.length,
    };
  }
}

export function hashEvents(events: RawLedgerEvent[]): string {
  const payload = events.map((e) => `${e.offset}:${e.updateId}`).join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export function emptyCheckpoint(): IndexerCheckpoint {
  return {
    lastOffset: "",
    eventCount: 0,
    lastEventHash: hashEvents([]),
    updatedAt: new Date().toISOString(),
  };
}

export { hashEvents as computeEventLogHash };
