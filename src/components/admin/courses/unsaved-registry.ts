/**
 * Tracks which editors on the current page hold unsaved edits, so actions that
 * refresh the page from the server (review/publish buttons in the course
 * header) can warn before those edits are replaced. Client-only state.
 */
const dirtySources = new Set<string>();

export function markUnsaved(sourceId: string, dirty: boolean): void {
  if (dirty) dirtySources.add(sourceId);
  else dirtySources.delete(sourceId);
}

export function hasUnsavedChanges(): boolean {
  return dirtySources.size > 0;
}
