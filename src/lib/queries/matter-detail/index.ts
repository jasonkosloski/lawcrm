/**
 * Matter Detail tab queries — a barrel over one reader file per tab
 *
 * One per tab — each takes a matterId and returns shaped rows ready
 * for the view layer. Parties, Deadlines, Tasks, Notes, and Documents
 * are the "list" tabs (simple filtered fetches). Timeline and Billing
 * are more complex aggregations and live elsewhere.
 */

export {
  eventLabelForViewer,
} from "./shared";
export {
  type ContactPhoneRow,
  type PartyRow,
  getMatterParties,
} from "./parties";
export {
  type DeadlineRow,
  type MatterListOptions,
  getMatterDeadlines,
} from "./deadlines";
export {
  type EntitySource,
  type TaskRow,
  type AttachedNotePreview,
  getMatterTasks,
  getLeadTasks,
} from "./tasks";
export {
  type NoteLink,
  type NoteReactionSummary,
  type NoteAttachedTask,
  type NoteAttachedDeadline,
  type NoteAttachedTimeEntry,
  type NoteRow,
  getMatterNotes,
  getLeadNotes,
} from "./notes";
export {
  type TimeEntryRow,
  type MatterTimeSummary,
  getMatterTimeEntries,
  getMatterTimeSummary,
} from "./time";
export {
  type MatterEventRow,
  getMatterEvents,
  getLeadEvents,
} from "./events";
export {
  type DocumentRow,
  shapeDocumentRows,
  getDocumentFolders,
  getFolderDocumentCounts,
} from "./documents";
export {
  type ExpenseRow,
  type ExpenseSummary,
  getMatterExpenses,
} from "./expenses";
export {
  type ActivityRow,
  MATTER_ACTIVITY_LIMIT,
  getMatterActivity,
  getMatterActivityTypeCounts,
  activityMoneyFilters,
  type ActivityMoneyAccess,
} from "./activity";
