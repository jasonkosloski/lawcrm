/** A Next.js `searchParams` value as one string: the first of a
 *  repeated `?k=a&k=b`, or undefined when absent. */
export function firstParam(
  raw: string | string[] | undefined
): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}
