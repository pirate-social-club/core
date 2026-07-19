export type NavigationTargets = {
  webUrl: string | null;
  freedomUrl: string | null;
};

/**
 * Native verified state is authoritative, including deliberate empty state.
 * The reviewed fallback is only an availability backstop when Fabric state
 * could not be determined at all.
 */
export function selectNavigationTargets(input: {
  fabricAvailable: boolean;
  native: NavigationTargets;
  fallback: NavigationTargets | null;
}): NavigationTargets {
  if (input.fabricAvailable) {
    return input.native;
  }
  return input.fallback ?? input.native;
}
