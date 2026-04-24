/**
 * Matter Detail — Communication tab
 *
 * Email threads linked to this matter (`matterId === matter.id`).
 * Click a thread to open it in the main inbox
 * (`/communication?thread=<id>`). When SMS lands this tab will show
 * both channels inline.
 */

import { EmbeddedThreadList } from "@/components/communication/embedded-thread-list";
import { listThreadsForMatter } from "@/lib/queries/communication";

export default async function MatterCommunicationPage({
  params,
}: PageProps<"/matters/[id]/communication">) {
  const { id } = await params;
  const threads = await listThreadsForMatter(id);

  return (
    <div className="p-5">
      <EmbeddedThreadList
        threads={threads}
        emptyLabel="No communication filed to this matter"
        emptyHint="Emails and text messages filed to this matter will appear here. File a thread from the main inbox or let auto-filing catch it."
        showMatterChip={false}
      />
    </div>
  );
}
