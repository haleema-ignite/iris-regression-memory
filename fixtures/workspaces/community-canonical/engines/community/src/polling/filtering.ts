export interface BoardFilterConfig {
  excludeSet: Set<string>;
  allowSet?: Set<string>;
  /** Show-hidden override (≡ legacy `enableShowHidden`). */
  includeHidden: boolean;
}

export function decideBoard(boardId: string, boardsMap: Map<string, Board>, cfg: BoardFilterConfig) {
  if (cfg.allowSet && cfg.allowSet.size > 0 && !cfg.allowSet.has(boardId)) {
    return { keep: false, reason: 'not-selected' };
  }
  if (cfg.excludeSet.has(boardId)) return { keep: false, reason: 'excluded' };
  if (!boardsMap.has(boardId)) return { keep: false, reason: 'unknown-board' };
  const board = boardsMap.get(boardId);
  if (board?.hidden === true && !cfg.includeHidden) {
    return { keep: false, reason: 'hidden' };
  }
  return { keep: true, reason: 'allowed' };
}
