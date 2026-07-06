import type { JsonLedgerClient } from "./index.js";
import {
  BIDDING_MANDATE_TEMPLATE_CANDIDATES,
  FINANCING_REQUEST_TEMPLATE_CANDIDATES,
} from "./commands.js";

/** Package id prefix from a ledger template id (hash or `#com-meridian-receivable-v6`). */
export function packageIdFromTemplateId(templateId: string): string {
  const prefix = templateId.split(":")[0] ?? templateId;
  return prefix.replace(/^#/, "").toLowerCase();
}

export function templateIdsSamePackage(a: string, b: string): boolean {
  return packageIdFromTemplateId(a) === packageIdFromTemplateId(b);
}

/** Entity suffix shared by all templateCandidates (e.g. `Meridian.Financing.BiddingMandate:BiddingMandate`). */
function templateEntitySuffix(candidates: readonly string[]): string | null {
  if (candidates.length === 0) return null;
  const parts = candidates[0]!.split(":");
  return parts.length >= 2 ? parts.slice(1).join(":") : null;
}

/** Resolve the on-ledger template id for a contract (avoids cross-version upgrade errors). */
export async function resolveContractTemplateId(
  client: JsonLedgerClient,
  parties: string[],
  contractId: string,
  templateCandidates: readonly string[]
): Promise<string | null> {
  for (const partyId of parties) {
    for (const templateId of templateCandidates) {
      const rows = await client.getActiveContractsByTemplate(partyId, templateId);
      const match = rows.find((r) => r.contractId === contractId);
      if (match) return match.templateId;
    }
    const entity = templateEntitySuffix(templateCandidates);
    if (entity) {
      const all = await client.getActiveContracts(partyId);
      const match = all.find(
        (r) => r.contractId === contractId && r.templateId.includes(entity)
      );
      if (match) return match.templateId;
    }
  }
  return null;
}

export async function resolveFinancingRequestTemplateId(
  client: JsonLedgerClient,
  parties: string[],
  requestContractId: string
): Promise<string> {
  const resolved = await resolveContractTemplateId(
    client,
    parties,
    requestContractId,
    FINANCING_REQUEST_TEMPLATE_CANDIDATES
  );
  if (!resolved) {
    throw new Error(
      `FinancingRequest contract not found on ledger: ${requestContractId.slice(0, 24)}…`
    );
  }
  return resolved;
}

export async function resolveBiddingMandateTemplateId(
  client: JsonLedgerClient,
  parties: string[],
  mandateContractId: string
): Promise<string> {
  const resolved = await resolveContractTemplateId(
    client,
    parties,
    mandateContractId,
    BIDDING_MANDATE_TEMPLATE_CANDIDATES
  );
  if (!resolved) {
    throw new Error(
      `BiddingMandate contract not found on ledger: ${mandateContractId.slice(0, 24)}…`
    );
  }
  return resolved;
}

export async function resolveMandateTemplateMap(
  client: JsonLedgerClient,
  financierPartyId: string,
  mandateContractIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const contractId of mandateContractIds) {
    const templateId = await resolveContractTemplateId(
      client,
      [financierPartyId],
      contractId,
      BIDDING_MANDATE_TEMPLATE_CANDIDATES
    );
    if (templateId) map.set(contractId, templateId);
  }
  return map;
}

export interface MandateCandidate {
  contractId: string;
  mandateId: string;
  agentEnabled: boolean;
  revoked: boolean;
}

/** Pick an agent-enabled mandate whose DAR package matches the financing round. */
export function pickMandateForRequestPackage(
  mandates: MandateCandidate[],
  mandateTemplateByCid: Map<string, string>,
  requestTemplateId: string
): { mandate: MandateCandidate; mandateTemplateId: string } | null {
  const requestPkg = packageIdFromTemplateId(requestTemplateId);
  for (const preferAgent of [true, false] as const) {
    for (const m of mandates) {
      if (m.revoked) continue;
      if (preferAgent && !m.agentEnabled) continue;
      const mandateTemplateId = mandateTemplateByCid.get(m.contractId);
      if (!mandateTemplateId) continue;
      if (packageIdFromTemplateId(mandateTemplateId) !== requestPkg) continue;
      return { mandate: m, mandateTemplateId };
    }
  }
  return null;
}
