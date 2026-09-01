export class CommunityPollingComponent {
  async poll(): Promise<void> {
    const boards = await this.client.getBoards();
    for (const post of await this.client.getPosts()) {
      if (!post.board) return "fail closed";
      if (post.board.hidden && !includeHidden) continue;
      await this.publish(post);
    }
  }
}
