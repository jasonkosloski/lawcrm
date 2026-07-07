/**
 * Template Editor Dialog — create + edit for the template library.
 *
 * Body is a monospace textarea with an insert-field picker fed by
 * the exported merge catalog (MERGE_FIELD_GROUPS), inserting
 * `{{key}}` at the cursor. The Preview toggle renders the body
 * against SAMPLE_MERGE_CONTEXT — clearly fake data, no matter fetch
 * — and warns about unknown tokens (typos) before they ship. The
 * textarea stays mounted while previewing (just hidden) so the form
 * still posts the body.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MERGE_FIELD_GROUPS,
  SAMPLE_MERGE_CONTEXT,
  mergeTemplate,
} from "@/lib/template-merge";
import {
  MAX_TEMPLATE_DESCRIPTION,
  MAX_TEMPLATE_NAME,
  TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABEL,
  templateFormInitialState,
  type TemplateCategory,
  type TemplateFormState,
} from "@/lib/template-constants";
import {
  createDocumentTemplate,
  updateDocumentTemplate,
} from "@/app/actions/document-templates";
import type { TemplateListItem } from "@/components/templates/template-library";

const fieldLabelCls =
  "text-2xs font-mono uppercase tracking-wider text-ink-4";
const inputCls =
  "h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4";

export function TemplateEditorDialog({
  open,
  onOpenChange,
  /** null = create a new template; a row = edit it. */
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: TemplateListItem | null;
}) {
  const action = template
    ? updateDocumentTemplate.bind(null, template.id)
    : createDocumentTemplate;
  // Wrapped useActionState: masks stale error/success across
  // close/reopen. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    TemplateFormState,
    FormData
  >(action, templateFormInitialState, open);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("general");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Sync fields from the row (or blank for create) each open —
  // render-phase reset (React's "adjusting state when a prop
  // changes" pattern) rather than an effect, so the old template's
  // text never paints for a frame.
  const [prevSync, setPrevSync] = useState<{
    open: boolean;
    templateId: string | null;
  }>({ open, templateId: template?.id ?? null });
  if (open !== prevSync.open || (template?.id ?? null) !== prevSync.templateId) {
    setPrevSync({ open, templateId: template?.id ?? null });
    if (open) {
      setName(template?.name ?? "");
      setCategory(template?.category ?? "general");
      setDescription(template?.description ?? "");
      setBody(template?.body ?? "");
      setPreviewing(false);
    }
  }

  // Close on success — keyed on the state OBJECT (identity is the
  // "a submission just landed" signal; see EditDeadlineDialog).
  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  const insertField = (key: string) => {
    const token = `{{${key}}}`;
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? start;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    // Restore focus + put the caret after the inserted token once
    // React has flushed the new value.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Sample preview is pure + client-side; only computed while shown.
  const preview = previewing
    ? mergeTemplate(body, SAMPLE_MERGE_CONTEXT)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {template ? "Edit template" : "New template"}
          </DialogTitle>
          <DialogDescription>
            {"Use the field picker (or type {{field.key}}) to add merge "}
            fields — they fill in from the matter, client, and firm when
            someone generates a document.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="template-name" className={fieldLabelCls}>
                Name <span className="text-warn">*</span>
              </label>
              <input
                id="template-name"
                name="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_TEMPLATE_NAME}
                placeholder='e.g. "Demand letter — UM/UIM"'
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="template-category" className={fieldLabelCls}>
                Category
              </label>
              <select
                id="template-category"
                name="category"
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as TemplateCategory)
                }
                className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
              >
                {TEMPLATE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {TEMPLATE_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="template-description" className={fieldLabelCls}>
              Description (optional)
            </label>
            <input
              id="template-description"
              name="description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={MAX_TEMPLATE_DESCRIPTION}
              placeholder="When to use this template"
              className={inputCls}
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="template-body" className={fieldLabelCls}>
                Body <span className="text-warn">*</span>
              </label>
              <div className="flex items-center gap-1.5">
                <InsertFieldMenu onInsert={insertField} />
                <div className="inline-flex rounded-md border border-line overflow-hidden">
                  <ModeButton
                    active={!previewing}
                    onClick={() => setPreviewing(false)}
                  >
                    Write
                  </ModeButton>
                  <ModeButton
                    active={previewing}
                    onClick={() => setPreviewing(true)}
                  >
                    Preview
                  </ModeButton>
                </div>
              </div>
            </div>

            {/* Textarea stays mounted while previewing so the form
                still posts `body`. */}
            <textarea
              id="template-body"
              ref={bodyRef}
              name="body"
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              placeholder={
                "Dear {{client.name}},\n\nRe: {{matter.name}}, No. {{matter.caseNumber}}\n\n…\n\n{{user.name}}\n{{firm.name}}"
              }
              spellCheck={false}
              className={cn(
                "px-2.5 py-2 rounded-md border border-line bg-white font-mono text-xs leading-relaxed text-ink",
                "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4",
                previewing && "hidden"
              )}
            />

            {preview && (
              <div className="flex flex-col gap-2">
                {preview.unresolved.length > 0 && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
                    <TriangleAlert size={12} className="shrink-0 mt-px" />
                    <span>
                      Unknown fields (left as-is):{" "}
                      {preview.unresolved.map((k) => `{{${k}}}`).join(", ")}
                    </span>
                  </div>
                )}
                <div className="px-3 py-2.5 rounded-md border border-line bg-paper-2/40 max-h-72 overflow-y-auto">
                  <div className="text-2xs text-ink-4 mb-1.5 font-mono uppercase tracking-wider">
                    Preview — sample data
                  </div>
                  <div className="text-xs text-ink whitespace-pre-wrap leading-relaxed">
                    {preview.text || (
                      <span className="text-ink-4">Nothing to preview yet.</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {state.status === "error" && state.error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
              <TriangleAlert size={12} className="shrink-0 mt-px" />
              <span>{state.error}</span>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? "Saving…"
                : template
                  ? "Save changes"
                  : "Create template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 h-7 text-2xs font-medium transition-colors",
        active
          ? "bg-brand-500 text-white"
          : "bg-white text-ink-3 hover:text-brand-700"
      )}
    >
      {children}
    </button>
  );
}

/** Grouped field picker fed by the exported merge catalog. */
function InsertFieldMenu({
  onInsert,
}: {
  onInsert: (key: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-line bg-white text-2xs font-medium text-ink-3 hover:text-brand-700 hover:border-brand-300 transition-colors"
          >
            Insert field
            <ChevronDown size={11} />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-56 max-h-80 overflow-y-auto">
        {MERGE_FIELD_GROUPS.map((group, gi) => (
          // DropdownMenuLabel is Base UI's Menu.GroupLabel — it must
          // sit inside a Menu.Group or the menu throws at open time.
          <DropdownMenuGroup key={group.group}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-2xs font-mono uppercase tracking-wider text-ink-4">
              {group.group}
            </DropdownMenuLabel>
            {group.fields.map((f) => (
              <DropdownMenuItem
                key={f.key}
                onClick={() => onInsert(f.key)}
                title={f.description}
              >
                <span className="flex-1">{f.label}</span>
                <span className="font-mono text-2xs text-ink-4">
                  {f.key}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
