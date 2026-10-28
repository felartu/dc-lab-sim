/** Expand simple shell variables while preserving single-quoted and escaped text. */
export function expandShellVariables(
  input: string,
  environment: Record<string, string>,
): string {
  let output = "";
  let quote: "single" | "double" | undefined;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === "\\" && quote !== "single" && i + 1 < input.length) {
      output += char + input[++i];
      continue;
    }
    if (char === "'" && quote !== "double")
      quote = quote === "single" ? undefined : "single";
    else if (char === '"' && quote !== "single")
      quote = quote === "double" ? undefined : "double";
    if (char === "$" && quote !== "single") {
      const match = input
        .slice(i)
        .match(/^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/);
      if (match) {
        output += environment[match[1] || match[2]] ?? "";
        i += match[0].length - 1;
        continue;
      }
    }
    output += char;
  }
  return output;
}
