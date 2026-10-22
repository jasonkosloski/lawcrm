/**
 * Provider error text is stored, shown and put in notifications. AssemblyAI
 * errors can echo the presigned media URL (a bearer link to the recording),
 * so any link is removed before the text goes anywhere.
 */
export function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, "[link removed]");
}
