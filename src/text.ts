/**
 * Text primitives shared by every executor.
 *
 * The compiler matches recorded tokens against source. A token found only in a
 * comment is not evidence that a behaviour exists, and a comment that quotes an
 * anti-pattern in order to warn about it is not a violation. Every executor
 * therefore matches against a comment-stripped view of the file, produced here.
 */

export type CommentSyntax = "c-like" | "hash" | "sql" | "none";

const C_LIKE = /\.(?:[cm]?[jt]sx?|java|kt|kts|go|cs|scala|swift|c|h|cc|cpp|hpp|rs)$/i;
const HASH = /\.(?:ya?ml|toml|ini|cfg|conf|properties|sh|bash|zsh|rb|py)$/i;
const SQL = /\.sql$/i;

/**
 * Languages in which a line cannot begin with `*` except as a block-comment
 * continuation. C, C++, Go and Rust are excluded: `*ptr = 1;` is a dereference
 * there, and blanking it would delete real code.
 */
const STAR_IS_ALWAYS_COMMENT = /\.(?:[cm]?[jt]sx?|java|kt|kts|cs|scala|swift)$/i;

export function commentSyntaxFor(path: string | undefined): CommentSyntax {
  if (!path) return "none";
  if (C_LIKE.test(path)) return "c-like";
  if (SQL.test(path)) return "sql";
  if (HASH.test(path)) return "hash";
  return "none";
}

/**
 * Consume a quoted string literal verbatim starting at `start`.
 * Returns the index just past the closing quote.
 *
 * Template literals are consumed whole: we deliberately do not descend into
 * `${...}`, because failing to strip a comment is always safer than stripping
 * code that a truth needs to match.
 */
function copyStringLiteral(src: string, start: number, out: string[]): number {
  const quote = src[start];
  out.push(quote as string);
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === "\\") {
      out.push(ch, src[i + 1] ?? "");
      i += 2;
      continue;
    }
    out.push(ch);
    i += 1;
    if (ch === quote) break;
    // An unterminated literal must not swallow the rest of the file.
    if (ch === "\n" && quote !== "`") break;
  }
  return i;
}

/**
 * Consume a regex literal verbatim, honouring backslash escapes and character
 * classes. Returns the index just past the closing slash.
 *
 * Without this, `/https:\/\//` ends in two literal slashes that read as the
 * start of a line comment, and everything after them on the line is discarded —
 * silently losing any token a truth needed to match there.
 */
function copyRegexLiteral(src: string, start: number, out: string[]): number {
  out.push("/");
  let i = start + 1;
  let inClass = false;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === "\n") break; // A regex literal cannot span lines.
    if (ch === "\\") {
      out.push(ch, src[i + 1] ?? "");
      i += 2;
      continue;
    }
    out.push(ch);
    i += 1;
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) break;
  }
  return i;
}

/**
 * Whether a `/` at this point begins a regex literal rather than division.
 *
 * The standard heuristic: a regex may only start where an expression may start,
 * which is after an operator, an opening bracket, a separator, or a keyword —
 * never directly after a value.
 */
const REGEX_PRECEDING_KEYWORD =
  /\b(?:return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/;

function regexCanStartHere(previousSignificant: string | undefined, out: string[]): boolean {
  if (previousSignificant === undefined) return true;
  // `<` and `>` are deliberately absent. They would make every JSX closing tag
  // — `</div>` — look like the start of a regex, so the scanner would swallow
  // the rest of the line looking for a closing slash and any comment after the
  // tag would survive. That reopens the comment-ghost bypass this stripper
  // exists to close. A regex directly after a comparison operator
  // (`a < /re/.test(b)`) does not occur in practice; JSX does, constantly.
  if ("(,=:[!&|?{};+-*%~^".includes(previousSignificant)) return true;
  // `=>` is the exception that has to be readmitted: `.filter(s => /x/.test(s))`
  // is ordinary code, and treating that slash as division truncates the line at
  // the regex's own `//`. Distinguishing `=>` from `</div>` needs the character
  // before the `>`, not just the `>`.
  if (previousSignificant === ">") {
    return out.slice(-6).join("").trimEnd().endsWith("=>");
  }
  // Only a word character can end one of the keywords below, so skip the tail
  // inspection otherwise. Joining the whole output buffer on every `/` would be
  // quadratic on a division-heavy file.
  if (!/\w/.test(previousSignificant)) return false;
  const tail = out.slice(-16).join("").trimEnd();
  return REGEX_PRECEDING_KEYWORD.test(tail);
}

function stripCLike(src: string): string {
  const out: string[] = [];
  let i = 0;
  let previousSignificant: string | undefined;
  while (i < src.length) {
    const ch = src[i] as string;
    const next = src[i + 1];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = copyStringLiteral(src, i, out);
      previousSignificant = ch;
      continue;
    }
    // A regex literal must be consumed whole; its body can contain `//`.
    if (ch === "/" && next !== "/" && next !== "*" && regexCanStartHere(previousSignificant, out)) {
      i = copyRegexLiteral(src, i, out);
      previousSignificant = "/";
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        // Preserve newlines so line numbers and per-line matching stay aligned.
        if (src[i] === "\n") out.push("\n");
        i += 1;
      }
      i += 2;
      continue;
    }
    out.push(ch);
    if (ch.trim().length > 0) previousSignificant = ch;
    i += 1;
  }
  return out.join("");
}

/**
 * Strip `marker`-to-end-of-line comments, one line at a time.
 *
 * Two rules matter, and both come from how YAML and shell actually behave:
 *
 *   - A marker only opens a comment at the start of a line or after
 *     whitespace. Without that, `$#`, `${path#prefix}` and `url=...#frag` all
 *     lost the rest of their line.
 *   - Quotes only protect a marker when they are balanced on that line. A lone
 *     apostrophe in prose (`name: don't run this  # disabled`) is not a string
 *     literal, and treating it as one swallowed the `#`, leaving a commented-out
 *     token readable as code — the comment-ghost bypass again, in YAML.
 */
function stripLinePrefix(src: string, marker: string): string {
  return src
    .split("\n")
    .map((line) => stripMarkerFromLine(line, marker, quotesBalanced(line)))
    .join("\n");
}

function quotesBalanced(line: string): boolean {
  let single = 0;
  let double = 0;
  for (const ch of line) {
    if (ch === "'") single += 1;
    else if (ch === '"') double += 1;
  }
  return single % 2 === 0 && double % 2 === 0;
}

function stripMarkerFromLine(line: string, marker: string, honourQuotes: boolean): string {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i] as string;
    if (honourQuotes && (ch === '"' || ch === "'")) {
      i = copyStringLiteral(line, i, out);
      continue;
    }
    // Only whitespace (or start of line) opens a comment.
    const atBoundary = i === 0 || /\s/.test(line[i - 1] ?? "");
    if (atBoundary && line.startsWith(marker, i)) break;
    out.push(ch);
    i += 1;
  }
  return out.join("");
}

const stripCache = new Map<string, string>();
const STRIP_CACHE_LIMIT = 512;
/**
 * Only whole files are worth caching. Individual diff lines also come through
 * here, hundreds per file, and would evict every file-sized entry before it
 * could be reused.
 */
const MIN_CACHEABLE_LENGTH = 512;

/**
 * Remove comments from `body` using the syntax implied by `path`.
 * Unknown file types are returned unchanged.
 */
export function stripComments(body: string, path?: string): string {
  const syntax = commentSyntaxFor(path);
  if (syntax === "none" || body.length === 0) return body;
  const cacheable = body.length >= MIN_CACHEABLE_LENGTH;
  // \u0000 cannot occur in source text, so it is an unambiguous separator.
  const key = `${syntax}\u0000${body}`;
  if (cacheable) {
    const cached = stripCache.get(key);
    if (cached !== undefined) return cached;
  }
  let result: string;
  switch (syntax) {
    case "c-like":
      result = stripCLike(body);
      break;
    case "hash":
      result = stripLinePrefix(body, "#");
      break;
    case "sql":
      result = stripLinePrefix(stripCLike(body), "--");
      break;
    default:
      result = body;
  }
  if (cacheable) {
    if (stripCache.size >= STRIP_CACHE_LIMIT) stripCache.clear();
    stripCache.set(key, result);
  }
  return result;
}

/**
 * A single diff line, stripped of comments.
 *
 * A diff line is a fragment: when it comes from the middle of a block comment,
 * the opening `/*` is not in the fragment, so the general stripper cannot tell
 * it is a comment. The real Instagram webhook has a JSDoc block explaining why
 * not to HMAC over a re-serialised body, and editing that block used to fail the
 * very truth it documents.
 *
 * A c-like line whose first non-space character is `*` is a block-comment
 * continuation by universal convention; nothing else starts a line that way.
 */
export function stripCommentsFromLine(line: string, path?: string): string {
  // The `*` must be followed by whitespace, another `*`, or `/` — that is what a
  // JSDoc continuation and a `*/` terminator look like. Requiring it keeps
  // generator methods (`*gen() {}`) and computed generators
  // (`*[Symbol.iterator]() {}`) from being blanked as comments.
  if (path && STAR_IS_ALWAYS_COMMENT.test(path) && /^\s*\*(?:[\s*/]|$)/.test(line)) return "";
  return stripComments(line, path);
}

/**
 * Whitespace- and comment-insensitive form of a line, used to decide whether an
 * "added" line is genuinely new or is the same code the diff also removed.
 */
export function normalizeLine(line: string, path?: string): string {
  return stripCommentsFromLine(line, path).replace(/\s+/g, " ").trim();
}

export function containsIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Longest line we will run a truth regex against.
 *
 * A generated or minified line is not authored code, and it is where regex cost
 * explodes: a bounded-gap pattern retried from every anchor match on a
 * 100-kilobyte line took over an hour on two benchmark cases. Substring checks
 * are linear and stay unbounded; only regex matching is capped.
 */
const MAX_REGEX_LINE_LENGTH = 4000;

/**
 * Test `line` against `source`, skipping lines too long to be authored code.
 *
 * Every truth regex goes through here so that no single pattern can hang a run.
 */
export function lineMatches(source: string, line: string): boolean {
  if (line.length > MAX_REGEX_LINE_LENGTH) return false;
  return cachedRegex(source).test(line);
}

const regexCache = new Map<string, RegExp>();

/**
 * Case-insensitive regex, compiled once per source string.
 * Truth patterns are validated at registry load, so this cannot throw for a
 * pattern that came from a truth file.
 */
export function cachedRegex(source: string): RegExp {
  const existing = regexCache.get(source);
  if (existing) return existing;
  const compiled = new RegExp(source, "i");
  regexCache.set(source, compiled);
  return compiled;
}

const MAX_PATTERN_LENGTH = 500;

export function compilePattern(source: string, origin: string): RegExp {
  if (source.length > MAX_PATTERN_LENGTH) {
    throw new Error(`${origin} pattern exceeds ${MAX_PATTERN_LENGTH} characters`);
  }
  // A quantified group whose body itself contains a quantifier or an
  // alternation is the catastrophic-backtracking shape. These patterns run over
  // every line of every scoped file, so reject them at load time rather than
  // hanging a run.
  //
  // The narrower `\([^)]*[+*]\)[+*]` only caught a quantifier immediately before
  // the closing paren, so `(a|a)*`, `(a{1,}){2,}` and `(a*|b)+` — the last of
  // which takes nine seconds on a 28-character input — all passed.
  if (/\([^()]*(?:[+*]|\{\d+,\}|\|)[^()]*\)\s*(?:[+*]|\{\d+,\})/.test(source)) {
    throw new Error(
      `${origin} has a quantified group containing a quantifier or alternation in ` +
      `\`${source}\`, which risks catastrophic backtracking`,
    );
  }
  try {
    return new RegExp(source, "i");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${origin} has invalid regular expression \`${source}\`: ${message}`);
  }
}
