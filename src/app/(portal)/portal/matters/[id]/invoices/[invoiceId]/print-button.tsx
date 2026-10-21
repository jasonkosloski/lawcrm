"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser print dialog; the portal chrome is `print:hidden`, so "Save as PDF" is chrome-free. */
export function PrintButton() {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-10 print:hidden"
      onClick={() => window.print()}
    >
      <Printer className="size-4" aria-hidden="true" />
      Download PDF
    </Button>
  );
}
