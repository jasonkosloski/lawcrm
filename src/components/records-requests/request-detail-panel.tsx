/**
 * Records request detail panel. Modal shell in the idiom of
 * src/components/calendar/event-detail-modal.tsx, driven by
 * `?request=<id>` and closed by removing that param.
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

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, Trash2, X } from "lucide-react";
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
import type { RecordScope } from "@/lib/record-scope";
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
import type { RecordsRequestDetail } from "@/lib/queries/records-requests";
import { cn } from "@/lib/utils";
import type { TypeOption, UserOption } from "./new-request-composer";

export type PanelPermissions = {
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
const field =
  "h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 disabled:opacity-60";
const label = "text-2xs font-mono uppercase tracking-wider text-ink-4";
const primaryBtn =
  "h-8 px-3 rounded-md bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 disabled:opacity-50";
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
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-3">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function RequestDetailPanel({
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
  can: PanelPermissions;
  /** False on a converted lead: nothing is editable. */
  writable: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("request");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      if (opener && opener !== document.body && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      // Escape inside a field only leaves the field.
      if (t && t.matches("input, textarea, select")) {
        t.blur();
        return;
      }
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

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
      if (res.ok) close();
      else setDeleteError(res.error ?? "Couldn't delete the request.");
    });
  };

  const [picked, setPicked] = useState<string[]>([]);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkPending, startLink] = useTransition();
  const onLink = () => {
    setLinkError(null);
    startLink(async () => {
      const res = await linkRecordsDocuments(detail.id, picked);
      if (res.ok) {
        setPicked([]);
        setOfferMark(true);
      } else {
        setLinkError(res.error ?? "Couldn't link the documents.");
      }
    });
  };
  const onUnlink = (documentId: string) => {
    startLink(async () => {
      await unlinkRecordsDocument(documentId);
    });
  };

  const nextStatuses = RECORDS_REQUEST_STATUSES.filter((s) => {
    if (s === "draft" || s === "sent") return !isOpen && s === "sent";
    const t = checkRecordsTransition(detail.status, s);
    return t.ok;
  });

  const letters = detail.documents.filter((d) => d.role === "request_letter");
  const received = detail.documents.filter((d) => d.role !== "request_letter");
  const showMarks = offerMark && canEdit && isOpen;

  const docList = (rows: typeof letters, empty: string) =>
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
                onClick={() => onUnlink(d.id)}
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

  return (
    <div className="contents">
      <button
        type="button"
        aria-label="Close request"
        tabIndex={-1}
        onClick={close}
        className="fixed inset-0 z-40 bg-black/25 backdrop-blur-sm cursor-default"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={detail.subject}
        tabIndex={-1}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(94vw,640px)] max-h-[88vh] rounded-xl shadow-2xl ring-1 ring-black/5 border border-line bg-white flex flex-col overflow-hidden outline-none"
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-line">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-ink truncate">
              {detail.subject}
            </h2>
            <p className="text-2xs text-ink-3 truncate">
              {detail.custodianName} · {detail.typeName}
            </p>
          </div>
          <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-paper-2 text-ink-3 border-line shrink-0">
            {RECORDS_STATUS_LABEL[detail.status]}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="text-ink-4 hover:text-ink-2"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Dates at a glance (also the status history). */}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {(
              [
                ["Sent", detail.sentAt],
                ["Response due", detail.responseDueDate],
                ["Next follow-up", detail.nextFollowUpDate],
                ["Received", detail.receivedAt],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex flex-col">
                <dt className={label}>{k}</dt>
                <dd className="text-ink">{v ? formatDateOnly(v) : "—"}</dd>
              </div>
            ))}
          </dl>

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
                    <select
                      id="rr-e-type"
                      value={typeChoice}
                      onChange={(e) => setTypeChoice(e.target.value)}
                      className={field}
                    >
                      {types.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                      {detail.typeId && !types.some((t) => t.id === detail.typeId) && (
                        <option value={detail.typeId}>{detail.typeName}</option>
                      )}
                      <option value={ADHOC}>Ad hoc (other)</option>
                    </select>
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
                    <select
                      id="rr-e-owner"
                      name="ownerId"
                      defaultValue={detail.ownerId ?? ""}
                      className={field}
                    >
                      <option value="">Unassigned</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                      {detail.ownerId && !users.some((u) => u.id === detail.ownerId) && (
                        <option value={detail.ownerId}>{detail.ownerName}</option>
                      )}
                    </select>
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
            {canEdit && isOpen && (
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

          <Section title="Documents">
            <div className="flex flex-col gap-1">
              <span className={label}>Request letters</span>
              {docList(letters, "No letter yet.")}
            </div>
            <div className="flex flex-col gap-1">
              <span className={label}>Received records</span>
              {docList(received, "Nothing received yet.")}
            </div>
            <div className="flex flex-wrap items-start gap-2">
              {canEdit && (
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
                  onUploaded={() => setOfferMark(true)}
                />
              )}
            </div>
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
                          checked={picked.includes(d.id)}
                          onChange={(e) =>
                            setPicked((p) =>
                              e.target.checked
                                ? [...p, d.id]
                                : p.filter((x) => x !== d.id)
                            )
                          }
                        />
                        {d.name}
                      </label>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={linkPending || picked.length === 0}
                  onClick={onLink}
                  className={cn(outlineBtn, "mt-2")}
                >
                  Link selected
                </button>
                {linkError && <div className="text-2xs text-warn mt-1">{linkError}</div>}
              </details>
            )}
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

          {can.delete && writable && (
            <div className="border-t border-line pt-3 flex flex-col gap-2">
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
          )}
        </div>
      </div>
    </div>
  );
}
