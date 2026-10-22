/**
 * Form field chrome for the app's compact forms: control classes, the
 * label style, a `Field` wrapper that wires label / hint / error to the
 * control for assistive tech, and the form-level error banner.
 *
 * `Field` takes either plain children or a render prop:
 *  - plain children without `htmlFor`: the label wraps the control.
 *  - plain children with `htmlFor` (the control's `id`): every
 *    text-like child control (input / select / textarea) gets
 *    `aria-invalid` and `aria-describedby` pointing at the error or
 *    hint, so a screen reader announces the problem on focus.
 *  - render prop: receives `{ id, aria-invalid, aria-describedby }` to
 *    spread onto the control; the id comes from `useId` (or `htmlFor`),
 *    so several rows of the same form on one page never collide.
 */

"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type FieldControlProps = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
};

/** Text-like control classes (input / select / textarea). `xs` is the
 *  dense inline-row size, `sm` the default form size, `md` the roomier
 *  page-level forms. Add height-free classes for textareas via `cn`. */
export function inputClass(
  hasError = false,
  size: "xs" | "sm" | "md" = "sm"
): string {
  return cn(
    "rounded-md border bg-white text-xs text-ink",
    size === "xs" ? "h-7 px-2" : size === "md" ? "h-9 px-3" : "h-8 px-2.5",
    "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
    "placeholder:text-ink-4",
    hasError ? "border-warn" : "border-line"
  );
}

export const labelClass = "text-xs font-medium text-ink-2";

/** One inline field error; renders nothing without a message. */
export function FieldError({
  id,
  children,
}: {
  id?: string;
  children?: ReactNode;
}) {
  if (children == null || children === "" || children === false) return null;
  return (
    <span id={id} className="text-2xs text-warn">
      {children}
    </span>
  );
}

const CONTROL_TAGS = new Set(["input", "select", "textarea"]);

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  labelClassName,
  children,
}: {
  label: ReactNode;
  /** The control's `id`. Optional with a render prop (useId fills it). */
  htmlFor?: string;
  hint?: ReactNode;
  /** A message, or a zod-style list whose first entry is shown. */
  error?: string | string[];
  required?: boolean;
  className?: string;
  labelClassName?: string;
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
}) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const message = Array.isArray(error) ? error[0] : error;
  const hasError = !!message;
  const hasHint = !!hint && !hasError;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = hasError ? errorId : hasHint ? hintId : undefined;
  const control: FieldControlProps = {
    id,
    "aria-invalid": hasError ? true : undefined,
    "aria-describedby": describedBy,
  };

  // No id to point at: wrap the control in the label instead, which
  // associates them implicitly.
  if (!htmlFor && typeof children !== "function") {
    return (
      <label className={cn("flex flex-col gap-1", className)}>
        <span className={cn(labelClass, labelClassName)}>
          {label}
          {required && <span className="text-warn ml-0.5">*</span>}
        </span>
        {children}
        {hasError && <FieldError>{message}</FieldError>}
        {hasHint && <span className="text-2xs text-ink-4">{hint}</span>}
      </label>
    );
  }

  const body =
    typeof children === "function"
      ? children(control)
      : Children.map(children, (child) => {
          if (!htmlFor) return child;
          if (!isValidElement(child) || typeof child.type !== "string") {
            return child;
          }
          if (!CONTROL_TAGS.has(child.type)) return child;
          const props = child.props as { type?: string };
          if (props.type === "hidden") return child;
          return cloneElement(child as ReactElement<Record<string, unknown>>, {
            "aria-invalid": control["aria-invalid"],
            "aria-describedby": describedBy,
          });
        });

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className={cn(labelClass, labelClassName)}>
        {label}
        {required && <span className="text-warn ml-0.5">*</span>}
      </label>
      {body}
      {hasError && <FieldError id={errorId}>{message}</FieldError>}
      {hasHint && (
        <span id={hintId} className="text-2xs text-ink-4">
          {hint}
        </span>
      )}
    </div>
  );
}

/** Banner for form-level (`_form`) errors and any error state that
 *  carries no field errors. Renders nothing without a message. */
export function FormErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn"
    >
      <TriangleAlert size={12} className="shrink-0 mt-px" />
      <span>{message}</span>
    </div>
  );
}

/** The message to show in the form-level banner: the action's `_form`
 *  error, or a generic fallback when it failed without any field
 *  errors. Field errors are rendered next to their fields. */
export function formErrorMessage(
  state: { status: "idle" | "ok" | "error"; errors?: Record<string, string[]> },
  fallback: string
): string | null {
  if (state.status !== "error") return null;
  const form = state.errors?._form?.[0];
  if (form) return form;
  const hasFieldErrors = Object.keys(state.errors ?? {}).length > 0;
  return hasFieldErrors ? null : fallback;
}
