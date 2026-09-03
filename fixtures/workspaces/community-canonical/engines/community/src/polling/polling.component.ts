export class CommunityPollingComponent extends BaseComponent {
  private async resolveBoardFilter(rt: Runtime, stream: string) {
    if (missingIds.length > 0) {
      let resolved: (BoardEnrichment | undefined)[];
      try {
        resolved = await mapWithConcurrency(
          missingIds,
          CONFIG.COMMUNITY_ENRICHMENT_CONCURRENCY,
          (id) => rt.client.resolveBoardVisibility(id),
        );
      } catch (err: any) {
        this.logger.error('Board-visibility by-id resolve failed — failing closed');
        return null;
      }
    }
  }
}
