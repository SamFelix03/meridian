import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncateParty(partyId: string, head = 20): string {
  if (partyId.length <= head + 3) return partyId;
  return `${partyId.slice(0, head)}…`;
}
