/**
 * Sanitized teaching snippet. Not production Instagram engine code.
 * Guard: resolve getMessagingUserProfile before publishing a DM author.
 */
export class InstagramWebhookSnippet {
  async authorName(
    senderId: string,
    getMessagingUserProfile: (igsid: string) => Promise<{ username?: string }>,
  ): Promise<string> {
    const profile = await getMessagingUserProfile(senderId);
    return profile.username ?? senderId;
  }
}
