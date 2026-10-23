/**
 * Full-page editor for a document template or a reusable block.
 *
 * Desktop: metadata form, toolbar + TipTap body (plus a one-line subject
 * for email), and a live preview. Below the `useIsDesktop` breakpoint
 * the page shows the sample preview only (the editor stays mounted,
 * hidden, so narrowing the window loses nothing). Saves always send the loaded
 * version (`expectedUpdatedAt`) and adopt the one a save returns; a
 * stale save offers Reload. A template whose fields don't fit its
 * applies-to cannot be saved until they are removed (the chips are
 * outlined).
 */

"use client";

export type { EditorBlock, EditorTemplate } from "./editor-model";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { type Editor as TiptapEditor } from "@tiptap/react";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { Button } from "@/components/ui/button";
import { saveDocumentTemplate } from "@/app/actions/document-templates";
import { saveTemplateBlock } from "@/app/actions/template-blocks";
import { cn } from "@/lib/utils";
import { checkTemplateFit, type FitResult } from "@/lib/templates/inspect";
import type { BlockSource } from "@/lib/templates/render";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import type { AppliesTo, TemplateDoc, TemplateKind } from "@/lib/templates/schema";
import {
  blockMeta,
  catalogFor,
  initialDoc,
  templateMeta,
  titleOf,
  type EditorProps,
} from "./editor-model";
import { templateJSON } from "./extensions";
import { FieldFormatPopover } from "./field-format-popover";
import { setFitInvalid } from "./fit-highlight";
import { EditorShell } from "@/components/editor/editor-shell";
import { BODY_CLASS, useBodyEditor } from "./use-body-editor";
import { BlockMetaFields, TemplateMetaFields, type TemplateMeta } from "./metadata-form";
import { EditorHeader, SaveErrorBanner } from "./page-chrome";
import { PreviewPane } from "./preview-pane";
import { RulePopover } from "./rule-popover";
import { SmsCounter } from "./sms-counter";
import { SubjectEditor } from "./subject-editor";
import { Toolbar } from "./toolbar";
import { EMAIL_FORMATTING_NOTE } from "@/lib/template-constants";
import { useUnsavedChangesGuard } from "./use-unsaved-guard";

const NO_BLOCKS: BlockSource[] = [];
export const FIT_BLOCKED = "Remove or replace the highlighted fields to save.";

/**
 * One editor instance for the page's lifetime: narrowing the window
 * (half-screen snap, tablet rotation) hides the editing surface instead
 * of unmounting it, so unsaved edits survive.
 */
export function TemplateEditorPage(props: EditorProps) {
  const narrow = !useIsDesktop();
  return <Editor {...props} narrow={narrow} />;
}

function Editor(props: EditorProps & { narrow: boolean }) {
  const router = useRouter();
  const { narrow } = props;
  const { canSave } = props;
  const isBlock = !!props.block;
  const source = props.block ?? props.template;
  const blocks = props.blocks ?? NO_BLOCKS;
  const [start] = useState(() => initialDoc(props));

  const [tMeta, setTMeta] = useState(() => (props.template ? templateMeta(props.template) : null));
  const [bMeta, setBMeta] = useState(() => (props.block ? blockMeta(props.block) : null));
  const [doc, setDoc] = useState<TemplateDoc>(start.doc);
  const [subject, setSubject] = useState<TemplateDoc | null>(props.template?.subject ?? null);
  const [savedId, setSavedId] = useState(source.id);
  const [version, setVersion] = useState(source.updatedAt);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [seedHtml, setSeedHtml] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [fieldEdit, setFieldEdit] = useState<{ subject: boolean; pos: number } | null>(null);
  const [ruleEdit, setRuleEdit] = useState<number | null>(null);
  const [subjectEditor, setSubjectEditor] = useState<TiptapEditor | null>(null);
  const [subjectFocused, setSubjectFocused] = useState(false);

  useUnsavedChangesGuard(dirty);

  // After Reload (router.refresh), adopt the server's version once the
  // props carry one different from ours (they may already have).
  if (reloading && source.updatedAt !== version) {
    setReloading(false);
    const fresh = initialDoc(props);
    setDoc(fresh.doc);
    setSubject(props.template?.subject ?? null);
    if (props.template) setTMeta(templateMeta(props.template));
    if (props.block) setBMeta(blockMeta(props.block));
    setVersion(source.updatedAt);
    setSeedHtml(null);
    setError(null);
    setDirty(false);
    setEditorKey((k) => k + 1);
  }

  const kind: TemplateKind = tMeta?.kind ?? "letter";
  const appliesTo: AppliesTo = tMeta?.appliesTo ?? "both";
  const { fields, lists, data } = useMemo(
    () => catalogFor(isBlock, appliesTo),
    [isBlock, appliesTo],
  );

  const editBodyField = useCallback((pos: number) => setFieldEdit({ subject: false, pos }), []);
  const editSubjectField = useCallback((pos: number) => setFieldEdit({ subject: true, pos }), []);
  const styles =
    props.paragraphStyles ?? props.pageStyle?.values.paragraphStyles ?? DEFAULT_PARAGRAPH_STYLES;
  const styleKeys = useMemo(() => new Set(styles.map((x) => x.key)), [styles]);
  const editor = useBodyEditor({
    styles,
    kind,
    isBlock,
    blocks,
    editable: canSave,
    content: seedHtml ?? doc,
    rebuildKey: editorKey,
    onDoc: setDoc,
    onEdit: () => setDirty(true),
    onFocus: () => setSubjectFocused(false),
    onEditField: editBodyField,
    onEditRule: setRuleEdit,
  });

  const subjectDoc = kind === "email" ? subject : null;
  const fit = useMemo(
    () =>
      isBlock
        ? ({ ok: true } as FitResult)
        : checkTemplateFit(doc, appliesTo, subjectDoc, styleKeys),
    [isBlock, doc, appliesTo, subjectDoc, styleKeys],
  );
  const invalidKey = fit.ok ? "" : fit.invalid.map((i) => i.path).join("\n");
  useEffect(() => {
    const paths = invalidKey ? invalidKey.split("\n") : [];
    setFitInvalid(editor, paths);
    setFitInvalid(subjectEditor, paths);
  }, [editor, subjectEditor, invalidKey]);

  const changeTemplateMeta = (patch: Partial<TemplateMeta>) => {
    // Kind changes rebuild the editor's schema; carry the content over
    // as HTML so nodes the new kind lacks degrade to text.
    if (patch.kind && patch.kind !== kind && editor) setSeedHtml(editor.getHTML());
    setTMeta((m) => (m ? { ...m, ...patch } : m));
    setDirty(true);
  };

  const save = () => {
    if (!editor) return;
    setError(null);
    const content = templateJSON(editor);
    const expectedUpdatedAt = savedId ? (version ?? undefined) : undefined;
    startSave(async () => {
      const res = bMeta
        ? await saveTemplateBlock({
            id: savedId ?? undefined,
            ...bMeta,
            content,
            expectedUpdatedAt,
          })
        : await saveDocumentTemplate({
            id: savedId ?? undefined,
            ...tMeta!,
            content,
            subject:
              kind === "email"
                ? subjectEditor
                  ? templateJSON(subjectEditor)
                  : subject
                : undefined,
            expectedUpdatedAt,
          });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setVersion(res.updatedAt);
      setDirty(false);
      if (!savedId) {
        setSavedId(res.id);
        router.replace(
          isBlock ? `/settings/templates/blocks/${res.id}` : `/settings/templates/${res.id}`,
        );
      }
    });
  };

  const fieldEditor = fieldEdit?.subject ? subjectEditor : editor;
  const preview = (allowRecord: boolean) => (
    <PreviewPane
      doc={doc}
      subject={subjectDoc}
      // A block previews as a filing page: house font and margins, no
      // letterhead around it, and "Preview as" a court.
      kind={isBlock ? "filing" : kind}
      appliesTo={appliesTo}
      blocks={blocks}
      pageStyle={props.pageStyle ?? null}
      styles={styles}
      courtFormats={props.courtFormats}
      allowRecord={allowRecord}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <EditorHeader
        isBlock={isBlock}
        title={titleOf(props)}
        usage={props.block?.id ? props.usage : undefined}
      >
        {canSave && !narrow && (
          <div className="ml-auto flex items-center gap-3">
            {!fit.ok && <span className="text-xs text-warn">{FIT_BLOCKED}</span>}
            <Button onClick={save} disabled={saving || !editor || !fit.ok}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </EditorHeader>

      {narrow && (
        <>
          <p className="text-xs text-ink-3">Edit on a larger screen.</p>
          {preview(false)}
        </>
      )}

      {/* Hidden, not unmounted, below desktop: unsaved edits survive. */}
      <div hidden={narrow} className="flex flex-col gap-5">
        {error && (
          <SaveErrorBanner
            error={error}
            onReload={() => {
              setReloading(true);
              router.refresh();
            }}
          />
        )}
        {start.legacy && (
          <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
            Converted from the old text format — review and save.
          </p>
        )}

        {tMeta && (
          <TemplateMetaFields meta={tMeta} disabled={!canSave} onChange={changeTemplateMeta} />
        )}
        {bMeta && (
          <BlockMetaFields
            meta={bMeta}
            disabled={!canSave}
            onChange={(p) => {
              setBMeta((m) => (m ? { ...m, ...p } : m));
              setDirty(true);
            }}
          />
        )}

        <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-5 items-start">
          <div className="flex flex-col gap-3">
            {kind === "email" && !isBlock && (
              <SubjectEditor
                key={editorKey}
                initial={subject}
                editable={canSave}
                onChange={(d) => {
                  setSubject(d);
                  setDirty(true);
                }}
                onFocus={() => setSubjectFocused(true)}
                onEditField={editSubjectField}
                onEditor={setSubjectEditor}
              />
            )}
            {kind === "email" && !isBlock && (
              <p className="text-2xs text-ink-3">{EMAIL_FORMATTING_NOTE}</p>
            )}
            <div className="rounded-md border border-line bg-white overflow-hidden">
              {editor ? (
                <EditorShell
                  editor={editor}
                  label="Template body"
                  readOnly={!canSave}
                  toolbar={
                    <Toolbar
                      editor={editor}
                      fieldTarget={subjectFocused && subjectEditor ? subjectEditor : editor}
                      kind={kind}
                      isBlock={isBlock}
                      fields={fields}
                      lists={lists}
                      data={data}
                      blocks={blocks.filter((b) => b.isActive)}
                      styles={styles}
                    />
                  }
                />
              ) : (
                <div className={cn(BODY_CLASS, "text-ink-4")}>Loading editor…</div>
              )}
            </div>
            {kind === "sms" && <SmsCounter doc={doc} appliesTo={appliesTo} />}
          </div>
          <div className="sticky top-0">{!narrow && preview(canSave && !isBlock)}</div>
        </div>
      </div>

      {canSave && !narrow && fieldEdit && fieldEditor && (
        <FieldFormatPopover
          editor={fieldEditor}
          pos={fieldEdit.pos}
          onClose={() => setFieldEdit(null)}
        />
      )}
      {canSave && !narrow && ruleEdit !== null && editor && (
        <RulePopover
          editor={editor}
          pos={ruleEdit}
          fields={fields}
          lists={lists}
          onClose={() => setRuleEdit(null)}
        />
      )}
    </div>
  );
}
