/**
 * Sanitized teaching snippet. Not production Instagram engine code.
 * Guard: persistState + POLL_WATERMARK_PERSISTENCE_ENABLED.
 */
export const POLL_WATERMARK_PERSISTENCE_ENABLED = true;

export class InstagramPollingSnippet {
  seenIds = new Set<string>();

  applySeenIds(ids: string[]): void {
    for (const id of ids) this.seenIds.add(id);
  }

  async persistState(put: (body: unknown) => Promise<void>): Promise<void> {
    if (!POLL_WATERMARK_PERSISTENCE_ENABLED) return;
    await put({ seenIds: [...this.seenIds] });
  }
}
