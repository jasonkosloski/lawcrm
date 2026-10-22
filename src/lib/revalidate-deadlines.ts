import { revalidatePath } from "next/cache";

/**
 * Every surface that renders a matter's deadlines. Lives outside the
 * "use server" action files (which may only export async functions)
 * so every path that creates or changes a deadline — the Deadlines
 * tab, note captures, email/messenger spawns, conversions — refreshes
 * the same set, including the firm calendar.
 */
export function revalidateDeadlineSurfaces(matterId: string): void {
  revalidatePath(`/matters/${matterId}/deadlines`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath("/"); // dashboard "Deadlines this week" card
  revalidatePath("/calendar");
}
