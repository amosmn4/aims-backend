export function plainAiText(value: string): string {
  return value
    .replace(/^\s*```[^\n]*\n?/gm, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/\*/g, "")
    .trim();
}
