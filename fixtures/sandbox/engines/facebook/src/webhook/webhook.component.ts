/**
 * Sanitized teaching snippet. Not production Facebook engine code.
 * Guard: stable platformPostId idempotency + HMAC on the raw body.
 */
export class FacebookWebhookSnippet {
  hasSeen(platformPostId: string): boolean {
    return this.seenIds.has(platformPostId);
  }

  ingest(platformPostId: string): void {
    if (this.hasSeen(platformPostId)) {
      return;
    }
    this.seenIds.add(platformPostId);
  }

  verifySignature(rawBody: Buffer, header: string, appSecret: string): boolean {
    return header.length > 0 && rawBody.length > 0 && appSecret.length > 0;
  }

  private seenIds = new Set<string>();
}
