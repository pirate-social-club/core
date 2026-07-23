import type { AuthorityTarget } from "./root-authority-observation";

type GlueRecord = {
  nameserver: string;
  address: string;
};

export type ParentAuthorityTarget = AuthorityTarget & {
  address_resolution_root: string | null;
  missing_address_failure_code: "missing_parent_glue" | "nameserver_address_resolution_failed";
};

function canonicalName(value: string): string {
  return value.endsWith(".") ? value.toLowerCase() : `${value.toLowerCase()}.`;
}

function nameserverRoot(nameserver: string): string | null {
  const labels = canonicalName(nameserver).slice(0, -1).split(".").filter(Boolean);
  return labels.at(-1) ?? null;
}

export function parentAuthorityTargets(
  rootLabel: string,
  parent: {
    nameservers: string[];
    glue4: GlueRecord[];
    glue6: GlueRecord[];
  },
): ParentAuthorityTarget[] {
  const root = canonicalName(rootLabel);
  const addresses = [...parent.glue4, ...parent.glue6];
  return [...new Set(parent.nameservers.map(canonicalName))].map((nameserver) => {
    const inBailiwick = nameserver === root || nameserver.endsWith(`.${root}`);
    return {
      nameserver,
      addresses: addresses
        .filter((glue) => canonicalName(glue.nameserver) === nameserver)
        .map((glue) => glue.address)
        .sort(),
      address_resolution_root: inBailiwick ? null : nameserverRoot(nameserver),
      missing_address_failure_code: inBailiwick
        ? "missing_parent_glue"
        : "nameserver_address_resolution_failed",
    };
  });
}
