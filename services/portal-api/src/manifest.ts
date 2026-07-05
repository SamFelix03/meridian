import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DevNetPartiesManifest, DevNetPersonaEntry } from "@meridian/shared-types";
import { extractCreatedContractId } from "@meridian/ledger-client";

export { extractCreatedContractId };

export interface PortalParties {
  supplier: DevNetPersonaEntry;
  buyer: DevNetPersonaEntry;
  financierA: DevNetPersonaEntry;
  financierB: DevNetPersonaEntry;
  platformOperator: DevNetPersonaEntry;
  regulator: DevNetPersonaEntry;
}

export function loadPortalParties(manifestPath: string): PortalParties {
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest not found: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as DevNetPartiesManifest;
  const supplier = manifest.personas.find((p) => p.orgId === "meridian-supplier");
  const buyer = manifest.personas.find((p) => p.orgId === "meridian-buyer");
  const financierA = manifest.personas.find((p) => p.orgId === "meridian-financier-a");
  const financierB = manifest.personas.find((p) => p.orgId === "meridian-financier-b");
  const platformOperator = manifest.personas.find((p) => p.orgId === "meridian-platform");
  const regulator = manifest.personas.find((p) => p.orgId === "meridian-regulator");
  if (!supplier || !buyer || !financierA || !financierB || !platformOperator || !regulator) {
    throw new Error("required personas missing from manifest");
  }
  return { supplier, buyer, financierA, financierB, platformOperator, regulator };
}

export async function proxyGet(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`proxy GET ${url}: ${res.status}`);
  return res.json();
}

export function defaultManifestPath(root: string): string {
  return join(root, "infra/manifests/parties.devnet.json");
}
