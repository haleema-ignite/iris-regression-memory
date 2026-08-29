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
    const removedLines: string[] = [];
    const contextLines: string[] = [];
    const allLines: string[] = [];
    let status: DiffFile["status"] = "modified";
    if (chunk.includes("new file mode")) status = "added";
    if (chunk.includes("deleted file mode")) status = "deleted";
    if (chunk.includes("rename from")) status = "renamed";

    for (const line of chunk.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
        continue;
      }
      if (line.startsWith("+")) {
        addedLines.push(line.slice(1));
        allLines.push(line.slice(1));
      } else if (line.startsWith("-")) {
        removedLines.push(line.slice(1));
        allLines.push(line.slice(1));
      } else if (line.startsWith(" ")) {
        const content = line.slice(1);
        contextLines.push(content);
        allLines.push(content);
      }
    }

    files.push({
      path,
      status,
      patch: `diff --git a/${path} b/${path}\n${chunk}`,
      addedLines,
      removedLines,
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
