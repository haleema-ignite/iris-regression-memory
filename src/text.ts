export function containsIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function compilePattern(source: string, origin: string): RegExp {
  try {
    return new RegExp(source, "i");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${origin} has invalid regular expression \`${source}\`: ${message}`);
  }
}
