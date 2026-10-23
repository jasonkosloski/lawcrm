/**
 * Link control: a toolbar button that opens a small popover to set,
 * change or remove (empty URL) the link on the selection. Validates
 * with the same rule the Email preset and the outgoing sanitizer use
 * (absolute http(s), mailto or tel), so the editor never holds a link the
 * server would strip.
 */

"use client";

import { useState, type FormEvent } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isAllowedEmailLink } from "../link-uri";
import { cn } from "@/lib/utils";

/** "example.com" -> "https://example.com"; anything with a scheme is left alone. */
function withScheme(raw: string): string {
  const v = raw.trim();
  if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  return `https://${v}`;
}

export function LinkButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      active: e.isActive("link"),
      selecting: !e.state.selection.empty,
    }),
  });
  const available = s.active || s.selecting;

  const onOpenChange = (next: boolean) => {
    if (next) {
      setUrl((editor.getAttributes("link").href as string | undefined) ?? "");
      setError(null);
    }
    setOpen(next);
  };

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const href = withScheme(url);
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else if (!isAllowedEmailLink(href)) {
      setError("Enter an http(s), mailto or tel link.");
      return;
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Link"
            title="Link"
            aria-pressed={s.active}
            disabled={!available}
            onMouseDown={(e) => e.preventDefault()}
            className={cn(
              "inline-flex h-7 min-w-7 items-center justify-center rounded px-1 text-ink-3 hover:bg-paper-2 hover:text-ink disabled:pointer-events-none disabled:opacity-40",
              s.active && "bg-paper-2 text-ink",
            )}
          >
            <LinkIcon size={13} />
          </button>
        }
      />
      <PopoverContent align="start" className="w-64">
        <form onSubmit={apply} className="flex flex-col gap-2">
          <Input
            aria-label="Link URL"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            autoFocus
          />
          {error && <div className="text-2xs text-warn">{error}</div>}
          <div className="flex justify-end">
            <Button type="submit" size="xs">
              {url.trim() ? "Apply" : "Remove link"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
