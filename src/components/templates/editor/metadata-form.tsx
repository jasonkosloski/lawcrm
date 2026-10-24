/**
 * The editor page's metadata fields: name, category, description, kind,
 * applies-to and (letters, filings) document title for a template; name, key and description for a block.
 */

"use client";

import { Field, inputClass } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import {
  APPLIES_TO_LABEL,
  MAX_DOCUMENT_TITLE,
  MAX_TEMPLATE_DESCRIPTION,
  MAX_TEMPLATE_NAME,
  TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABEL,
  TEMPLATE_KIND_LABEL,
  isTemplateCategory,
} from "@/lib/template-constants";
import {
  APPLIES_TO,
  TEMPLATE_KINDS,
  isDocumentKind,
  type AppliesTo,
  type TemplateKind,
} from "@/lib/templates/schema";

export type TemplateMeta = {
  name: string;
  category: string;
  description: string;
  documentTitle: string;
  kind: TemplateKind;
  appliesTo: AppliesTo;
};

export type BlockMeta = { name: string; key: string; description: string; appliesTo: AppliesTo };

const input = cn(inputClass(false, "sm"), "w-full");

function NameField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (name: string) => void;
}) {
  return (
    <Field label="Name" required>
      {(c) => (
        <input
          {...c}
          className={input}
          value={value}
          maxLength={MAX_TEMPLATE_NAME}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

function DescriptionField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (description: string) => void;
}) {
  return (
    <Field label="Description" className="col-span-full">
      {(c) => (
        <input
          {...c}
          className={input}
          value={value}
          maxLength={MAX_TEMPLATE_DESCRIPTION}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

function AppliesToField({
  value,
  disabled,
  onChange,
}: {
  value: AppliesTo;
  disabled: boolean;
  onChange: (appliesTo: AppliesTo) => void;
}) {
  return (
    <Field label="Applies to">
      {(c) => (
        <NativeSelect
          {...c}
          className="w-full"
          size="sm"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as AppliesTo)}
        >
          {APPLIES_TO.map((a) => (
            <NativeSelectOption key={a} value={a}>
              {APPLIES_TO_LABEL[a]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}

export function TemplateMetaFields({
  meta,
  disabled,
  onChange,
}: {
  meta: TemplateMeta;
  disabled: boolean;
  onChange: (patch: Partial<TemplateMeta>) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-3">
      <NameField value={meta.name} disabled={disabled} onChange={(name) => onChange({ name })} />
      <Field label="Category">
        {(c) => (
          <NativeSelect
            {...c}
            className="w-full"
            size="sm"
            value={meta.category}
            disabled={disabled}
            onChange={(e) => onChange({ category: e.target.value })}
          >
            {/* An imported row's non-curated category stays selectable. */}
            {!isTemplateCategory(meta.category) && (
              <NativeSelectOption value={meta.category}>{meta.category}</NativeSelectOption>
            )}
            {TEMPLATE_CATEGORIES.map((cat) => (
              <NativeSelectOption key={cat} value={cat}>
                {TEMPLATE_CATEGORY_LABEL[cat]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field label="Kind">
        {(c) => (
          <NativeSelect
            {...c}
            className="w-full"
            size="sm"
            value={meta.kind}
            disabled={disabled}
            onChange={(e) => onChange({ kind: e.target.value as TemplateKind })}
          >
            {TEMPLATE_KINDS.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {TEMPLATE_KIND_LABEL[k]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </Field>
      <AppliesToField
        value={meta.appliesTo}
        disabled={disabled}
        onChange={(appliesTo) => onChange({ appliesTo })}
      />
      {isDocumentKind(meta.kind) && (
        <Field
          label="Document title"
          className="col-span-full"
          hint="Prints in the Document title field; can be changed when generating."
        >
          {(c) => (
            <input
              {...c}
              className={input}
              value={meta.documentTitle}
              maxLength={MAX_DOCUMENT_TITLE}
              disabled={disabled}
              placeholder="e.g. Motion to Dismiss"
              onChange={(e) => onChange({ documentTitle: e.target.value })}
            />
          )}
        </Field>
      )}
      <DescriptionField
        value={meta.description}
        disabled={disabled}
        onChange={(description) => onChange({ description })}
      />
    </div>
  );
}

export function BlockMetaFields({
  meta,
  disabled,
  onChange,
}: {
  meta: BlockMeta;
  disabled: boolean;
  onChange: (patch: Partial<BlockMeta>) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <NameField value={meta.name} disabled={disabled} onChange={(name) => onChange({ name })} />
      <Field label="Key" hint="Lowercase letters, digits and underscores, e.g. signature_block.">
        {(c) => (
          <input
            {...c}
            className={cn(input, "font-mono")}
            value={meta.key}
            maxLength={40}
            disabled={disabled}
            onChange={(e) => onChange({ key: e.target.value })}
          />
        )}
      </Field>
      <AppliesToField
        value={meta.appliesTo}
        disabled={disabled}
        onChange={(appliesTo) => onChange({ appliesTo })}
      />
      <DescriptionField
        value={meta.description}
        disabled={disabled}
        onChange={(description) => onChange({ description })}
      />
    </div>
  );
}
