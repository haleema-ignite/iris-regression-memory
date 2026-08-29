/**
 * Sanitized teaching snippet. Not production Facebook engine code.
 * Guard: per-page authState; skip only the blocked page.
 */
export class FacebookPollingSnippet {
  pollPage(page: { id: string; authState?: { class: string } }, error?: { code: number }): void {
    if (page.authState?.class === "TOKEN_INVALID") {
      return;
    }
    if (error?.code === 190) {
      page.authState = { class: "TOKEN_INVALID" };
      return;
    }
  }
}
