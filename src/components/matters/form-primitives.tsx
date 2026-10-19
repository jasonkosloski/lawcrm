/**
 * Layout + field primitives shared by NewMatterForm and EditMatterForm.
 *
 * `Field` wires its label, hint and first error to the control for
 * assistive tech: every text-like control child gets `aria-invalid`
 * and `aria-describedby` pointing at the error (or hint) element, so a
 * screen reader announces the problem when the invalid field is focused.
 */

import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-2xs font-mono uppercase tracking-wider text-ink-4">
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}

const CONTROL_TAGS = new Set(["input", "select", "textarea"]);

export function Field({
  label,
  name,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  /** Also the `id` of the control — the label's `htmlFor`. */
  name: string;
  required?: boolean;
  error?: string[];
  hint?: string;
  children: ReactNode;
}) {
  const hasError = !!error && error.length > 0;
  const hasHint = !!hint && !hasError;
  const messageId = hasError
    ? `${name}-error`
    : hasHint
      ? `${name}-hint`
      : undefined;

  const described = Children.map(children, (child) => {
    if (!isValidElement(child) || typeof child.type !== "string") return child;
    if (!CONTROL_TAGS.has(child.type)) return child;
    const props = child.props as { type?: string };
    if (props.type === "hidden") return child;
    return cloneElement(child as ReactElement<Record<string, unknown>>, {
      "aria-invalid": hasError ? true : undefined,
      "aria-describedby": messageId,
    });
  });

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-xs font-medium text-ink-2">
        {label}
        {required && <span className="text-warn ml-0.5">*</span>}
      </label>
      {described}
      {hasError && (
        <div id={`${name}-error`} className="text-2xs text-warn">
          {error![0]}
        </div>
      )}
      {hasHint && (
        <div id={`${name}-hint`} className="text-2xs text-ink-4">
          {hint}
        </div>
      )}
    </div>
  );
}

export const inputCls = (hasError: boolean): string =>
  cn(
    "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
    "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
    "placeholder:text-ink-4",
    hasError ? "border-warn" : "border-line"
  );
