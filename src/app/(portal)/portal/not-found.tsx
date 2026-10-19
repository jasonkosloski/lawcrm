/** Portal 404. Plain and portal-styled; no staff links. */

import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalMessage } from "./portal-message";

export default function PortalNotFound() {
  return (
    <PortalMessage
      icon={FileQuestion}
      title="Page not found"
      description="This page doesn’t exist, or you no longer have access to it."
    >
      <Button size="lg" className="h-10 px-4" render={<Link href="/" />}>
        Go to my matters
      </Button>
    </PortalMessage>
  );
}
