import { PowerDnsApiClient } from "../../../services/verifier/hns/src/pdns-store";
import {
  associationFromCertificateFile,
  prepareInitialTlsa,
} from "../hns-authoritative-dns/tlsa-rollover";

const certificatePath = Bun.env.HNS_LOCAL_TLSA_CERT_PATH?.trim();
const statePath = Bun.env.HNS_LOCAL_TLSA_STATE_PATH?.trim();
if (!certificatePath || !statePath) {
  throw new Error("HNS_LOCAL_TLSA_CERT_PATH and HNS_LOCAL_TLSA_STATE_PATH are required");
}

const association = await associationFromCertificateFile(certificatePath);
const store = new PowerDnsApiClient({
  apiUrl: Bun.env.PDNS_API_URL?.trim() || "http://primary:8081",
  apiKey: Bun.env.PDNS_API_KEY?.trim() || "local-pdns-api-key",
  defaultSoaContent: "unused.invalid. unused.invalid. 0 3600 900 1209600 300",
  zoneKind: "Master",
});

const state = await prepareInitialTlsa({
  store,
  statePath,
  association,
  configuredAssociations: [association],
  ttlSeconds: 60,
  zoneAllowlist: ["crew."],
});

console.log(JSON.stringify({ association, state }));
