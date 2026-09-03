import type { DiffFile, ParsedDiff } from "./types.ts";

const SANDBOX_PREFIX = "fixtures/sandbox/";
const PATCH_UNAVAILABLE_MARKER = "IRIS_REGRESSION_MEMORY_PATCH_UNAVAILABLE";

export function stripSandboxPrefix(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.startsWith(SANDBOX_PREFIX)) {
    return normalized.slice(SANDBOX_PREFIX.length);
  }
  return normalized;
}

export function candidatePaths(filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const stripped = stripSandboxPrefix(normalized);
  return stripped === normalized ? [normalized] : [normalized, stripped];
}

export function parseUnifiedDiff(raw: string): ParsedDiff {
  const files: DiffFile[] = [];
  const chunks = raw.split(/^diff --git /m).filter((chunk) => chunk.trim().length > 0);

  for (const chunk of chunks) {
    const header = chunk.split("\n")[0] ?? "";
    const plusMatch = header.match(/\sb\/(.+)$/);
    const minusMatch = header.match(/^a\/(.+?)\s+b\//);
    let path = plusMatch?.[1]?.trim() ?? minusMatch?.[1]?.trim() ?? "";

    const plusLine = chunk.match(/^\+\+\+\s+(?:b\/)?(.+)$/m);
    const minusLine = chunk.match(/^---\s+(?:a\/)?(.+)$/m);
    if (plusLine?.[1] && plusLine[1] !== "/dev/null") {
      path = plusLine[1].trim();
    } else if (minusLine?.[1] && minusLine[1] !== "/dev/null") {
      path = minusLine[1].trim();
    }

    path = path.replace(/^[ab]\//, "");
    if (!path || path === "/dev/null") {
      continue;
    }

    const addedLines: string[] = [];
    const addedLineNumbers: number[] = [];
    const removedLines: string[] = [];
    const removedLineNumbers: number[] = [];
    const contextLines: string[] = [];
    const allLines: string[] = [];
    // Mode and rename markers only appear in the header, before the first
    // hunk. Searching the whole chunk let a *content* line such as
    // `+deleted file mode 100644` set the status to deleted, which then made
    // the reconstructed after-state empty.
    const hunkStart = chunk.search(/^@@/m);
    const preamble = hunkStart === -1 ? chunk : chunk.slice(0, hunkStart);
    let status: DiffFile["status"] = "modified";
    if (preamble.includes("new file mode")) status = "added";
    if (preamble.includes("deleted file mode")) status = "deleted";
    if (preamble.includes("rename from")) status = "renamed";

    // Only body lines carry +/-/space markers. Classifying by prefix without
    // tracking hunk boundaries loses any removed line whose own content starts
    // with "--" (it looks like a `---` file header) and any added line starting
    // with "++". SQL comments and diff-in-diff content hit this constantly.
    let inHunk = false;
    // 1-based line numbers in the new and old files, tracked from hunk headers
    // so an added line can be located in the real after-state. Without that,
    // deciding whether a line is a comment means inspecting the diff line on its
    // own, which cannot see that it sits inside a `/* ... */` block.
    let newLine = 0;
    let oldLine = 0;
    for (const line of chunk.split("\n")) {
      const hunk = line.match(/^@@+ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        inHunk = true;
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
        continue;
      }
      if (line.startsWith("@@")) {
        inHunk = true;
        continue;
      }
      if (!inHunk) continue;
      // "\ No newline at end of file" is metadata, not content.
      if (line.startsWith("\\")) continue;
      if (line.startsWith("+")) {
        addedLines.push(line.slice(1));
        addedLineNumbers.push(newLine);
        allLines.push(line.slice(1));
        newLine += 1;
      } else if (line.startsWith("-")) {
        removedLines.push(line.slice(1));
        removedLineNumbers.push(oldLine);
        allLines.push(line.slice(1));
        oldLine += 1;
      } else if (line.startsWith(" ")) {
        const content = line.slice(1);
        contextLines.push(content);
        allLines.push(content);
        newLine += 1;
        oldLine += 1;
      }
    }

    files.push({
      path,
      status,
      patch: `diff --git a/${path} b/${path}\n${chunk}`,
      addedLines,
      addedLineNumbers,
      removedLines,
      removedLineNumbers,
      contextLines,
      allLines,
      patchAvailable: !chunk.includes(PATCH_UNAVAILABLE_MARKER),
    });
  }

  return { files, raw };
}

export function filesToUnifiedDiff(
  files: Array<{ filename: string; status?: string; patch?: string | null }>,
): string {
  return files
    .map((file) => {
      const path = file.filename;
      if (!file.patch) {
        return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +0,0 @@\n ${PATCH_UNAVAILABLE_MARKER}`;
      }
      const hasGitHeader = file.patch.startsWith("diff --git");
      if (hasGitHeader) {
        return file.patch;
      }
      return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${file.patch}`;
    })
    .join("\n");
}
