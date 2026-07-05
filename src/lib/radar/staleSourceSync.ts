export type ExistingSourceRow = {
  sourceId: string;
  enabled: boolean;
};

/**
 * Pure utility: returns the sourceIds of DB source rows that are currently
 * enabled but are no longer present in the active registry. The Convex
 * syncSources mutation uses this to patch stale rows to enabled=false,
 * notify=false. Keeping it pure makes it independently testable.
 */
export function findStaleSourcesToDisable(
  registrySourceIds: Set<string>,
  existingSources: ExistingSourceRow[],
): string[] {
  return existingSources
    .filter((s) => s.enabled && !registrySourceIds.has(s.sourceId))
    .map((s) => s.sourceId);
}
