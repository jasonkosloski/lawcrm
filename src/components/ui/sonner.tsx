"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleAlert, CircleCheck, Info, Loader2, TriangleAlert } from "lucide-react"

/**
 * App-wide toast region (shadcn "sonner", brand-styled). Mounted once in
 * Providers; call through src/lib/feedback.ts rather than importing
 * `toast` directly so tests can mock one module.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      icons={{
        success: <CircleCheck className="size-4 text-ok" />,
        error: <CircleAlert className="size-4 text-danger" />,
        warning: <TriangleAlert className="size-4 text-warn" />,
        info: <Info className="size-4 text-brand-500" />,
        loading: <Loader2 className="size-4 animate-spin text-ink-3" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-lg !border !border-line !bg-card !text-ink !shadow-md !text-[13px] !font-sans",
          description: "!text-ink-3",
          closeButton: "!border-line !bg-card !text-ink-3 hover:!text-ink",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
