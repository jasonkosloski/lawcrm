/**
 * Records request detail page body (client). Rendered by the request
 * page under the Records tab (`.../records/[requestId]`): header with
 * the status actions, a main column (request documents, responsive
 * documents, follow-ups) and a side column (details, fee).
 *
 * History is the follow-up log (newest first) plus the sent / received
 * dates: a per-request ActivityLog feed would need a request FK on
 * ActivityLog (out of scope; ADR-047).
 *
 * Every control is hidden when the viewer's permissions (or a converted
 * lead's read-only state) wouldn't allow it: the server re-checks, but a
 * refused action redirects and loses typed input. Date inputs and
 * displays are date-only (ADR-012): keys in, `formatDateOnly` out.
 */

"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Trash2, X } from "lucide-react";
import {
  deleteRecordsRequest,
  linkRecordsDocuments,
  logRecordsFollowUp,
  markRecordsRequestSent,
  saveRecordsFee,
  setRecordsRequestStatus,
  unlinkRecordsDocument,
  updateRecordsRequest,
} from "@/app/actions/records-requests";
import { MultiFileUpload } from "@/components/matters/documents/multi-file-upload";
import {
  GenerateFromTemplateDialog,
  type TemplateOption,
} from "@/components/templates/generate-from-template-dialog";
import { dateOnlyKey, formatDateOnly } from "@/lib/format-date";
import { scopeBasePath, type RecordScope } from "@/lib/record-scope";
import type { StorageDriver } from "@/lib/storage/storage-key";
import {
  recordsRequestInitialState,
  type RecordsRequestFormState,
} from "@/lib/records-requests/form";
import {
  RECORDS_REQUEST_STATUSES,
  RECORDS_STATUS_LABEL,
  checkRecordsTransition,
  isRecordsRequestOpen,
} from "@/lib/records-requests/status";
import {
  RECORDS_ROLE_INFO,
  type RecordsDocRole,
} from "@/lib/records-requests/roles";
import { dueBadge } from "@/lib/records-requests/due-badge";
import {
  dueCountdownLabel,
  sentAgoLabel,
} from "@/lib/records-requests/date-labels";
import type { RecordsRequestDetail } from "@/lib/queries/records-requests";
import { cn } from "@/lib/utils";
import type { TypeOption, UserOption } from "./new-request-composer";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { inputClass } from "@/components/ui/field";

export type RequestDetailPermissions = {
  /** records.edit */
  edit: boolean;
  /** records.delete */
  delete: boolean;
  /** documents.upload */
  upload: boolean;
  /** Fee section: records.edit, plus matters.expense.create on a matter. */
  fee: boolean;
};

const ADHOC = "__adhoc";
const field = cn(inputClass(), "disabled:opacity-60");
const label = "text-xs font-medium text-ink-2";
const primaryBtn =
  "h-8 px-3 rounded-md bg-brand-700 text-white text-xs font-medium hover:bg-brand-900 disabled:opacity-50";
const outlineBtn =
  "h-8 px-3 rounded-md border border-line bg-white text-xs font-medium text-ink-2 hover:border-brand-300 hover:text-brand-700 disabled:opacity-50";

const key = (d: Date | null) => (d ? dateOnlyKey(d) : "");

/** Run a form action from onSubmit (keeps typed input on error) and
 *  hold its result. */
function useFormRun(
  run: (fd: FormData) => Promise<RecordsRequestFormState>,
  opts: { resetOnOk?: boolean } = {}
) {
  const [state, setState] = useState<RecordsRequestFormState>(
    recordsRequestInitialState
  );
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    start(async () => {
      const res = await run(fd);
      setState(res);
      if (res.status === "ok" && opts.resetOnOk) form.reset();
    });
  };
  return { state, pending, submit };
}

function FormMessage({ state }: { state: RecordsRequestFormState }) {
  const msg = state.errors?._form?.[0];
  if (msg) return <div className="text-2xs text-warn">{msg}</div>;
  if (state.status === "ok")
    return <div className="text-2xs text-ok">Saved.</div>;
  return null;
}

function FieldError({
  state,
  name,
}: {
  state: RecordsRequestFormState;
  name: string;
}) {
  const m = state.errors?.[name]?.[0];
  return m ? <span className="text-2xs text-warn">{m}</span> : null;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3">
      <h3 className="text-2xs font-medium text-ink-3">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function RequestDetail({
  detail,
  scope,
  types,
  users,
  templates,
  defaultTemplateId,
  storageDriver,
  linkableDocuments,
  can,
  writable,
  daysUntilDue = null,
  daysSinceSent = null,
  deadlineRule = null,
}: {
  detail: RecordsRequestDetail;
  scope: RecordScope;
  types: TypeOption[];
  users: UserOption[];
  templates: TemplateOption[];
  /** The request type's default letter template, when it has one. */
  defaultTemplateId: string | null;
  storageDriver: StorageDriver;
  /** Scope documents not already on this request, for "Link existing". */
  linkableDocuments: { id: string; name: string }[];
  can: RequestDetailPermissions;
  /** False on a converted lead: nothing is editable. */
  writable: boolean;
  /** Days to the response due date in the viewer's zone (list-row badge). */
  daysUntilDue?: number | null;
  /** Whole days since the request was sent, in the viewer's zone. */
  daysSinceSent?: number | null;
  /** How the due date was set: "3 business days after sending", or null. */
  deadlineRule?: string | null;
}) {
  const router = useRouter();
  const recordsHref = `${scopeBasePath(scope)}/records`;

  const canEdit = can.edit && writable;
  const isOpen = isRecordsRequestOpen(detail.status);
  const isDraft = detail.status === "draft";

  // After an upload / link, offer (never auto-apply) a status mark.
  const [offerMark, setOfferMark] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusPending, startStatus] = useTransition();
  const setStatus = (status: (typeof RECORDS_REQUEST_STATUSES)[number]) => {
    setStatusError(null);
    startStatus(async () => {
      const res = await setRecordsRequestStatus(detail.id, status);
      if (res.ok) {
        setOfferMark(false);
      } else {
        setStatusError(res.error ?? "Couldn't change the status.");
      }
    });
  };

  const sent = useFormRun((fd) =>
    markRecordsRequestSent(detail.id, recordsRequestInitialState, fd)
  );
  const edit = useFormRun((fd) =>
    updateRecordsRequest(detail.id, recordsRequestInitialState, fd)
  );
  const followUp = useFormRun(
    (fd) => logRecordsFollowUp(detail.id, recordsRequestInitialState, fd),
    { resetOnOk: true }
  );
  const fee = useFormRun((fd) =>
    saveRecordsFee(detail.id, recordsRequestInitialState, fd)
  );

  const [typeChoice, setTypeChoice] = useState(detail.typeId ?? ADHOC);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, startDelete] = useTransition();
  const onDelete = () => {
    setDeleteError(null);
    startDelete(async () => {
      const res = await deleteRecordsRequest(detail.id);
      if (res.ok) router.push(recordsHref);
      else setDeleteError(res.error ?? "Couldn't delete the request.");
    });
  };

  const [picked, setPicked] = useState<Record<RecordsDocRole, string[]>>({
    request_letter: [],
    received_records: [],
  });
  const [linkError, setLinkError] = useState<{
    role: RecordsDocRole;
    message: string;
  } | null>(null);
  const [linkPending, startLink] = useTransition();
  const onLink = (role: RecordsDocRole) => {
    setLinkError(null);
    startLink(async () => {
      const res = await linkRecordsDocuments(detail.id, picked[role], role);
      if (res.ok) {
        setPicked((p) => ({ ...p, [role]: [] }));
        // Only responsive documents suggest a status change.
        if (role === "received_records") setOfferMark(true);
      } else {
        setLinkError({
          role,
          message: res.error ?? "Couldn't link the documents.",
        });
      }
    });
  };
  const onUnlink = (documentId: string, role: RecordsDocRole) => {
    setLinkError(null);
    startLink(async () => {
      const res = await unlinkRecordsDocument(documentId);
      if (!res.ok) setLinkError({ role, message: "Couldn't unlink the document." });
    });
  };

  // Drafts leave via Mark sent (or by closing); a closed request reopens
  // to draft if it was never sent, else to a sent-or-later status.
  const nextStatuses = RECORDS_REQUEST_STATUSES.filter((s) => {
    if (isDraft) return false;
    return checkRecordsTransition(detail.status, s, {
      hasSentAt: detail.sentAt != null,
    }).ok;
  });

  const letters = detail.documents.filter((d) => d.role === "request_letter");
  // Untagged-role documents (legacy) show under responsive, as before.
  const received = detail.documents.filter((d) => d.role !== "request_letter");
  const showMarks = offerMark && canEdit && isOpen && !isDraft;

  const docList = (rows: typeof letters, empty: string, role: RecordsDocRole) =>
    rows.length === 0 ? (
      <p className="text-2xs text-ink-4">{empty}</p>
    ) : (
      <ul className="flex flex-col gap-1">
        {rows.map((d) => (
          <li key={d.id} className="flex items-center gap-2 text-xs">
            <FileText size={12} className="text-ink-4 shrink-0" />
            <a
              href={d.href}
              className="text-ink hover:text-brand-700 hover:underline truncate"
            >
              {d.name}
            </a>
            {canEdit && (
              <button
                type="button"
                onClick={() => onUnlink(d.id, role)}
                aria-label={`Unlink ${d.name}`}
                className="ml-auto text-ink-4 hover:text-warn"
              >
                <X size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
    );

  const linkPanel = (role: RecordsDocRole) => {
    const err = linkError?.role === role ? linkError.message : null;
    const sel = picked[role];
    return (
      <>
        {err && linkableDocuments.length === 0 && (
          <div className="text-2xs text-warn">{err}</div>
        )}
        {canEdit && linkableDocuments.length > 0 && (
          <details className="rounded-md border border-line px-2.5 py-1.5">
            <summary className="text-xs text-ink-3 cursor-pointer">
              Link existing documents
            </summary>
            <ul className="mt-2 flex flex-col gap-1 max-h-40 overflow-y-auto">
              {linkableDocuments.map((d) => (
                <li key={d.id}>
                  <label className="flex items-center gap-2 text-xs text-ink-2">
                    <input
                      type="checkbox"
                      checked={sel.includes(d.id)}
                      onChange={(e) =>
                        setPicked((p) => ({
                          ...p,
                          [role]: e.target.checked
                            ? [...p[role], d.id]
                            : p[role].filter((x) => x !== d.id),
                        }))
                      }
                    />
                    {d.name}
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={linkPending || sel.length === 0}
              onClick={() => onLink(role)}
              className={cn(outlineBtn, "mt-2")}
            >
              Link selected
            </button>
            {err && <div className="text-2xs text-warn mt-1">{err}</div>}
          </details>
        )}
      </>
    );
  };

  const badge = dueBadge({ status: detail.status, daysUntilDue });

  const deleteControl = can.delete && writable && (
    <div className="flex flex-col items-end gap-1">
      {confirmDelete ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-2">
            Delete this request and its follow-ups?
          </span>
          <button
            type="button"
            disabled={deletePending}
            onClick={onDelete}
            className="h-8 px-3 rounded-md bg-warn text-white text-xs font-medium disabled:opacity-50"
          >
            Confirm delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="text-xs text-ink-3 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="inline-flex items-center gap-1.5 text-xs text-warn hover:underline w-fit"
        >
          <Trash2 size={12} />
          Delete request
        </button>
      )}
      {deleteError && <div className="text-2xs text-warn">{deleteError}</div>}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Link
          href={recordsHref}
          className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-brand-700 w-fit"
        >
          <ArrowLeft size={13} />
          Records requests
        </Link>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-64">
            <h1 className="text-lg font-semibold text-ink">{detail.subject}</h1>
            <p className="text-xs text-ink-3">
              {detail.custodianName} · {detail.typeName}
            </p>
          </div>
          <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full bg-paper-2 text-ink-3 border-line shrink-0">
            {RECORDS_STATUS_LABEL[detail.status]}
          </span>
          {badge && (
            <span
              className={cn(
                "inline-block text-2xs font-medium px-2 py-0.5 rounded-full shrink-0",
                badge.overdue
                  ? "bg-warn-soft text-warn border-warn-border"
                  : "bg-paper-2 text-ink-3 border-line"
              )}
            >
              {badge.text}
            </span>
          )}
          <div className="flex flex-col items-end gap-2 ml-auto">
            {canEdit && isDraft && (
              <form onSubmit={sent.submit} className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="rr-sent-on" className={label}>
                    Sent on
                  </label>
                  <input id="rr-sent-on" name="sentAt" type="date" className={field} />
                  <FieldError state={sent.state} name="sentAt" />
                </div>
                {!detail.typeId && (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="rr-sent-due" className={label}>
                      Response due
                    </label>
                    <input
                      id="rr-sent-due"
                      name="responseDueDate"
                      type="date"
                      defaultValue={key(detail.responseDueDate)}
                      className={field}
                    />
                    <FieldError state={sent.state} name="responseDueDate" />
                  </div>
                )}
                <button type="submit" disabled={sent.pending} className={primaryBtn}>
                  Mark sent
                </button>
                <FormMessage state={sent.state} />
              </form>
            )}
            {canEdit && !isDraft && nextStatuses.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className={label}>{isOpen ? "Move to" : "Reopen as"}</span>
                {nextStatuses.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={statusPending}
                    onClick={() => setStatus(s)}
                    className={outlineBtn}
                  >
                    {RECORDS_STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            )}
            {statusError && <div className="text-2xs text-warn">{statusError}</div>}
            {deleteControl}
          </div>
        </div>
      </div>

      {/* Dates at a glance (also the status history): when it went out
          and when the answer is due are the two that matter most. */}
      <DateSummary
        sentAt={detail.sentAt}
        responseDueDate={detail.responseDueDate}
        nextFollowUpDate={detail.nextFollowUpDate}
        receivedAt={detail.receivedAt}
        daysSinceSent={daysSinceSent}
        daysUntilDue={isOpen ? daysUntilDue : null}
        deadlineRule={deadlineRule}
        isDraft={isDraft}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-4 min-w-0">
          <Section title={RECORDS_ROLE_INFO.request_letter.label}>
            {docList(letters, "No request documents yet.", "request_letter")}
            <div className="flex flex-wrap items-start gap-2">
              {canEdit && can.upload && (
                <GenerateFromTemplateDialog
                  scope={scope}
                  templates={templates}
                  canUpload={can.upload}
                  recordsRequestId={detail.id}
                  defaultTemplateId={defaultTemplateId}
                  triggerLabel="Generate letter"
                />
              )}
              {can.upload && writable && (
                <MultiFileUpload
                  scope={scope}
                  folderId={null}
                  folderName={null}
                  storageDriver={storageDriver}
                  recordsRequestId={detail.id}
                  recordsRole="request_letter"
                />
              )}
            </div>
            {linkPanel("request_letter")}
          </Section>

          <Section title={RECORDS_ROLE_INFO.received_records.label}>
            {docList(received, "No responsive documents yet.", "received_records")}
            <div className="flex flex-wrap items-start gap-2">
              {can.upload && writable && (
                <MultiFileUpload
                  scope={scope}
                  folderId={null}
                  folderName={null}
                  storageDriver={storageDriver}
                  recordsRequestId={detail.id}
                  recordsRole="received_records"
                  onUploaded={() => setOfferMark(true)}
                />
              )}
            </div>
            {linkPanel("received_records")}
            {showMarks && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper-2/40 px-3 py-2">
                <span className="text-xs text-ink-3">Records came in?</span>
                {detail.status !== "partial" && (
                  <button
                    type="button"
                    disabled={statusPending}
                    onClick={() => setStatus("partial")}
                    className={outlineBtn}
                  >
                    Mark partial
                  </button>
                )}
                <button
                  type="button"
                  disabled={statusPending}
                  onClick={() => setStatus("complete")}
                  className={outlineBtn}
                >
                  Mark complete
                </button>
              </div>
            )}
          </Section>

          <Section title="Follow-ups">
            {detail.followUps.length === 0 ? (
              <p className="text-2xs text-ink-4">No follow-ups logged yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {detail.followUps.map((f) => (
                  <li key={f.id} className="text-xs text-ink-2">
                    <span className="font-mono text-2xs text-ink-4">
                      {formatDateOnly(f.occurredAt)}
                    </span>{" "}
                    <span className="text-ink-3">{f.userName}</span>
                    {f.note ? ` — ${f.note}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && isOpen && !isDraft && (
              <form onSubmit={followUp.submit} className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1 flex-1 min-w-48">
                  <label htmlFor="rr-fu-note" className={label}>Note</label>
                  <input
                    id="rr-fu-note"
                    name="note"
                    type="text"
                    maxLength={2000}
                    placeholder="Called records dept., promised by Friday"
                    className={field}
                  />
                </div>
                <button type="submit" disabled={followUp.pending} className={outlineBtn}>
                  Log follow-up
                </button>
                <FormMessage state={followUp.state} />
              </form>
            )}
          </Section>
        </div>
        <div className="flex flex-col gap-4 min-w-0">
          <Section title="Details">
            {canEdit ? (
              <form
                key={detail.updatedAt}
                onSubmit={edit.submit}
                className="flex flex-col gap-3"
              >
                <input type="hidden" name="custodianContactId" value={detail.custodianContactId} />
                <input type="hidden" name="expectedUpdatedAt" value={detail.updatedAt} />
                <input type="hidden" name="typeId" value={typeChoice === ADHOC ? "" : typeChoice} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="rr-e-type" className={label}>Type</label>
                    <NativeSelect
                      id="rr-e-type"
                      value={typeChoice}
                      onChange={(e) => setTypeChoice(e.target.value)}
                      className="w-full"
                    >
                      {types.map((t) => (
                        <NativeSelectOption key={t.id} value={t.id}>{t.name}</NativeSelectOption>
                      ))}
                      {detail.typeId && !types.some((t) => t.id === detail.typeId) && (
                        <NativeSelectOption value={detail.typeId}>{detail.typeName}</NativeSelectOption>
                      )}
                      <NativeSelectOption value={ADHOC}>Ad hoc (other)</NativeSelectOption>
                    </NativeSelect>
                  </div>
                  {typeChoice === ADHOC && (
                    <div className="flex flex-col gap-1">
                      <label htmlFor="rr-e-adhoc" className={label}>Type of records</label>
                      <input
                        id="rr-e-adhoc"
                        name="adHocTypeName"
                        type="text"
                        maxLength={200}
                        defaultValue={detail.adHocTypeName ?? ""}
                        className={field}
                      />
                      <FieldError state={edit.state} name="adHocTypeName" />
                    </div>
                  )}
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label htmlFor="rr-e-subject" className={label}>Subject</label>
                    <input
                      id="rr-e-subject"
                      name="subject"
                      type="text"
                      required
                      maxLength={300}
                      defaultValue={detail.subject}
                      className={field}
                    />
                    <FieldError state={edit.state} name="subject" />
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label htmlFor="rr-e-desc" className={label}>Details</label>
                    <textarea
                      id="rr-e-desc"
                      name="description"
                      rows={2}
                      maxLength={4000}
                      defaultValue={detail.description ?? ""}
                      className="px-2 py-1.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500"
                    />
                  </div>
                  {(
                    [
                      ["dateRangeStart", "Records from", detail.dateRangeStart],
                      ["dateRangeEnd", "Records through", detail.dateRangeEnd],
                      ["sentAt", "Sent date", detail.sentAt],
                      ["responseDueDate", "Response due date", detail.responseDueDate],
                      ["nextFollowUpDate", "Next follow-up", detail.nextFollowUpDate],
                    ] as const
                  ).map(([name, text, value]) => (
                    <div key={name} className="flex flex-col gap-1">
                      <label htmlFor={`rr-e-${name}`} className={label}>{text}</label>
                      <input
                        id={`rr-e-${name}`}
                        name={name}
                        type="date"
                        defaultValue={key(value)}
                        className={field}
                      />
                      <FieldError state={edit.state} name={name} />
                    </div>
                  ))}
                  <div className="flex flex-col gap-1">
                    <label htmlFor="rr-e-owner" className={label}>Owner</label>
                    <NativeSelect
                      id="rr-e-owner"
                      name="ownerId"
                      defaultValue={detail.ownerId ?? ""}
                      className="w-full"
                    >
                      <NativeSelectOption value="">Unassigned</NativeSelectOption>
                      {users.map((u) => (
                        <NativeSelectOption key={u.id} value={u.id}>{u.name}</NativeSelectOption>
                      ))}
                      {detail.ownerId && !users.some((u) => u.id === detail.ownerId) && (
                        <NativeSelectOption value={detail.ownerId}>{detail.ownerName}</NativeSelectOption>
                      )}
                    </NativeSelect>
                    <FieldError state={edit.state} name="ownerId" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button type="submit" disabled={edit.pending} className={primaryBtn}>
                    Save changes
                  </button>
                  <FormMessage state={edit.state} />
                </div>
              </form>
            ) : (
              <p className="text-xs text-ink-2 whitespace-pre-wrap">
                {detail.description || "No details."}
                {detail.ownerName ? `\nOwner: ${detail.ownerName}` : ""}
              </p>
            )}
          </Section>

          {can.fee && writable && (
            <Section title="Fee">
              <form key={`fee-${detail.updatedAt}`} onSubmit={fee.submit} className="flex flex-wrap items-end gap-3">
                {(
                  [
                    ["feeEstimate", "Fee estimate", detail.feeEstimate, "text"],
                    ["feeAmount", "Fee amount", detail.feeAmount, "text"],
                    ["feePaidAt", "Fee paid on", key(detail.feePaidAt), "date"],
                  ] as const
                ).map(([name, text, value, type]) => (
                  <div key={name} className="flex flex-col gap-1">
                    <label htmlFor={`rr-f-${name}`} className={label}>{text}</label>
                    <input
                      id={`rr-f-${name}`}
                      name={name}
                      type={type}
                      inputMode={type === "text" ? "decimal" : undefined}
                      defaultValue={value ?? ""}
                      disabled={detail.expenseLocked}
                      className={cn(field, type === "text" && "w-28")}
                    />
                    <FieldError state={fee.state} name={name} />
                  </div>
                ))}
                <button
                  type="submit"
                  disabled={fee.pending || detail.expenseLocked}
                  className={outlineBtn}
                >
                  Save fee
                </button>
                <FormMessage state={fee.state} />
              </form>
              {detail.expenseLocked && (
                <p className="text-2xs text-ink-4">
                  This fee is on an invoice and can&apos;t be changed here.
                </p>
              )}
              {scope.kind === "matter" ? (
                <p className="text-2xs text-ink-4">
                  Entering an amount and a paid date records an expense on the matter.
                </p>
              ) : (
                <p className="text-2xs text-ink-4">
                  Kept on the request; it becomes an expense once the matter exists.
                </p>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function DateSummary({
  sentAt,
  responseDueDate,
  nextFollowUpDate,
  receivedAt,
  daysSinceSent,
  daysUntilDue,
  deadlineRule,
  isDraft,
}: {
  sentAt: Date | null;
  responseDueDate: Date | null;
  nextFollowUpDate: Date | null;
  receivedAt: Date | null;
  daysSinceSent: number | null;
  /** Null once the request is closed: no countdown on a finished request. */
  daysUntilDue: number | null;
  deadlineRule: string | null;
  isDraft: boolean;
}) {
  const countdown = daysUntilDue === null ? null : dueCountdownLabel(daysUntilDue);
  return (
    <section
      aria-label="Key dates"
      className="rounded-lg border border-line bg-white p-4 flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1" data-testid="sent-tile">
          <span className="text-2xs font-medium text-ink-3">
            Sent
          </span>
          {sentAt ? (
            <>
              <span className="text-xl font-semibold text-ink">
                {formatDateOnly(sentAt, "medium")}
              </span>
              {daysSinceSent !== null && (
                <span className="text-xs text-ink-3">{sentAgoLabel(daysSinceSent)}</span>
              )}
            </>
          ) : (
            <>
              <span className="text-xl font-semibold text-ink-4">Not sent yet</span>
              {isDraft && (
                <span className="text-xs text-ink-3">
                  Mark it sent to start the response clock.
                </span>
              )}
            </>
          )}
        </div>
        <div
          className={cn(
            "flex flex-col gap-1 rounded-md -m-2 p-2",
            countdown?.overdue && "bg-warn-soft"
          )}
          data-testid="due-tile"
        >
          <span className="text-2xs font-medium text-ink-3">
            Response due
          </span>
          {responseDueDate ? (
            <>
              <span
                className={cn(
                  "text-xl font-semibold",
                  countdown?.overdue ? "text-warn" : "text-ink"
                )}
              >
                {formatDateOnly(responseDueDate, "medium")}
              </span>
              {countdown && (
                <span
                  className={cn(
                    "text-xs font-medium",
                    countdown.overdue ? "text-warn" : "text-ink-2"
                  )}
                >
                  {countdown.text}
                </span>
              )}
              <span className="text-2xs text-ink-4">
                {deadlineRule ?? "Set manually"}
              </span>
            </>
          ) : (
            <>
              <span className="text-xl font-semibold text-ink-4">
                {isDraft ? "Set when sent" : "No deadline"}
              </span>
              {!isDraft && (
                <span className="text-xs text-ink-3">
                  This request type has no statutory response period.
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs">
        {(
          [
            ["Next follow-up", nextFollowUpDate],
            ["Received", receivedAt],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-2xs font-medium text-ink-3">{k}</dt>
            <dd className="text-ink">{v ? formatDateOnly(v) : "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
