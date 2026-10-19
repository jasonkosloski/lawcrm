import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Styled native <select> (shadcn "native-select", tuned to the staff
 * form style in matters/form-primitives `inputCls`). Native on purpose:
 * it posts with the form, keeps the OS picker on phones, and works with
 * `userEvent.selectOptions` in tests.
 *
 * `className` sizes the WRAPPER (w-full, flex-1, max-w-*); every other
 * prop, `ref` included, goes to the <select>. Errors: `aria-invalid`.
 */
type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
}

function NativeSelect({
  className,
  size = "default",
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn(
        "group/native-select relative w-fit has-[select:disabled]:opacity-50",
        className
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="h-8 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border border-line bg-white py-1 pr-7 pl-2.5 text-xs text-ink transition-colors outline-none hover:border-ink-4/60 focus-visible:border-brand-500 focus-visible:ring-3 focus-visible:ring-brand-500/20 disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-warn aria-invalid:ring-3 aria-invalid:ring-warn/15 data-[size=sm]:h-7 data-[size=sm]:pl-2 data-[size=sm]:text-[11px]"
        {...props}
      />
      <ChevronDownIcon
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-4 select-none group-data-[size=sm]/native-select:size-3"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  )
}

function NativeSelectOption(props: React.ComponentProps<"option">) {
  return <option data-slot="native-select-option" {...props} />
}

function NativeSelectOptGroup(props: React.ComponentProps<"optgroup">) {
  return <optgroup data-slot="native-select-optgroup" {...props} />
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
