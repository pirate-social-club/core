import type { OnboardingStatus } from "../types/api";
import type {
  ExternalReputationSnapshotRow,
  GlobalHandleRow,
  JobRow,
  NamespaceVerificationRow,
  NamespaceVerificationSessionRow,
  RedditVerificationSessionRow,
  UserRow,
} from "../types/db";
import { deriveOnboardingStatus as deriveRedditAwareOnboardingStatus } from "./reddit-onboarding";

export function deriveOnboardingStatus(input: {
  activeGlobalHandleRow: GlobalHandleRow;
  userRow: UserRow;
  latestNamespaceVerificationRow?: NamespaceVerificationRow | null;
  latestNamespaceVerificationSessionRow?: NamespaceVerificationSessionRow | null;
  latestRedditVerificationRow?: RedditVerificationSessionRow | null;
  latestRedditImportJobRow?: JobRow | null;
  latestRedditSnapshotRow?: ExternalReputationSnapshotRow | null;
}): OnboardingStatus {
  return deriveRedditAwareOnboardingStatus({
    activeGlobalHandleIssuedByGeneratedSignup: input.activeGlobalHandleRow.issuance_source === "generated_signup",
    cleanupRenameAvailable: !Boolean(input.activeGlobalHandleRow.free_rename_consumed),
    verificationCapabilitiesJson: input.userRow.verification_capabilities_json,
    latestNamespaceVerificationRow: input.latestNamespaceVerificationRow ?? null,
    latestNamespaceVerificationSessionRow: input.latestNamespaceVerificationSessionRow ?? null,
    latestRedditVerificationRow: input.latestRedditVerificationRow ?? null,
    latestRedditImportJobRow: input.latestRedditImportJobRow ?? null,
    latestRedditSnapshotRow: input.latestRedditSnapshotRow ?? null,
  });
}
