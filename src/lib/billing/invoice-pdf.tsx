/**
 * Server-side invoice PDF. Mirrors the sections and labels of
 * `InvoicePreview` (letterhead, meta + bill-to, services, expenses,
 * totals, payments, notes) and renders the STORED figures: totals are
 * never recomputed here (ADR-024 / ADR-036).
 *
 * Issue / due dates are instants shown in `timeZone`; line, expense and
 * payment dates are date-only values (ADR-012).
 */
import "server-only";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import {
  invoiceStatusLabel,
  INVOICE_PAYMENT_SOURCE_LABEL,
  type InvoiceKind,
  type InvoicePaymentSource,
} from "@/lib/billing-form";
import type { FirmProfile } from "@/lib/firm";
import { formatDate, formatDateOnly } from "@/lib/format-date";
import type { InvoiceDetail } from "@/lib/queries/billing";

const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function invoicePdfFilename(invoiceNumber: string): string {
  return `Invoice ${invoiceNumber}.pdf`;
}

const INK = "#1a1a1a";
const MUTED = "#6b6b6b";
const LINE = "#d4d4d4";

const s = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 9, color: INK },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  section: {
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
  },
  label: { fontSize: 8, color: MUTED, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  firmName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  muted: { color: MUTED },
  bold: { fontFamily: "Helvetica-Bold" },
  invNo: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "right" },
  right: { textAlign: "right" },
  th: {
    color: MUTED,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    paddingBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.25,
    borderBottomColor: LINE,
  },
  metaRow: { flexDirection: "row", marginBottom: 2 },
  metaKey: { width: 56, color: MUTED },
  totals: { alignSelf: "flex-end", width: 200 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  totalFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 3,
    paddingTop: 3,
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    fontFamily: "Helvetica-Bold",
  },
});

function InvoicePdfDocument({
  invoice,
  firm,
  timeZone,
}: {
  invoice: InvoiceDetail;
  firm: FirmProfile;
  timeZone: string;
}) {
  const isInternal = invoice.kind === "internal_record";
  const isVoid = invoice.status === "void";
  const firmAddress = [
    firm.addressLine1,
    firm.addressLine2,
    [firm.city, firm.state, firm.zip].filter(Boolean).join(", "),
  ].filter(Boolean);
  const addr = invoice.clientAddress;
  const cityLine = addr
    ? [addr.city, addr.state, addr.zip].filter(Boolean).join(", ")
    : "";
  const gap = invoice.paidAmount - invoice.paymentsRecordedTotal;

  return (
    <Document title={`Invoice ${invoice.invoiceNumber}`} author={firm.name}>
      <Page size="LETTER" style={s.page}>
        {/* Letterhead */}
        <View style={[s.section, s.between]}>
          <View>
            <Text style={s.firmName}>{firm.name}</Text>
            {firmAddress.map((line, i) => (
              <Text key={i} style={s.muted}>
                {line}
              </Text>
            ))}
            {(firm.phone || firm.email) && (
              <Text style={[s.muted, { marginTop: 3 }]}>
                {[firm.phone, firm.email].filter(Boolean).join(" · ")}
              </Text>
            )}
          </View>
          <View>
            <Text style={[s.label, s.right]}>
              {isInternal ? "Internal Record" : "Invoice"}
            </Text>
            <Text style={s.invNo}>{invoice.invoiceNumber}</Text>
            <Text style={[s.muted, s.right, { marginTop: 3 }]}>
              {invoiceStatusLabel(invoice.status, invoice.kind as InvoiceKind)}
            </Text>
          </View>
        </View>

        {/* Bill-to + meta */}
        <View style={[s.section, s.between]}>
          <View style={{ width: 260 }}>
            {isInternal ? (
              <>
                <Text style={s.label}>For matter file</Text>
                <Text style={s.bold}>Internal record — not billed</Text>
              </>
            ) : (
              <>
                <Text style={s.label}>Bill to</Text>
                <Text style={s.bold}>{invoice.clientName ?? "—"}</Text>
                {invoice.clientEmail && (
                  <Text style={s.muted}>{invoice.clientEmail}</Text>
                )}
                {addr?.line1 && <Text style={s.muted}>{addr.line1}</Text>}
                {cityLine !== "" && <Text style={s.muted}>{cityLine}</Text>}
              </>
            )}
            <Text style={[s.muted, { marginTop: 5 }]}>
              <Text style={s.bold}>Re:</Text> {invoice.matterName}
            </Text>
          </View>
          <View style={{ width: 200 }}>
            <View style={s.metaRow}>
              <Text style={s.metaKey}>Issued</Text>
              <Text>{formatDate(invoice.issueDate, "long", timeZone)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaKey}>Due</Text>
              <Text>{formatDate(invoice.dueDate, "long", timeZone)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaKey}>Total</Text>
              <Text style={s.bold}>{formatMoney(invoice.totalAmount)}</Text>
            </View>
            {invoice.paidAmount > 0 && (
              <View style={s.metaRow}>
                <Text style={s.metaKey}>Paid</Text>
                <Text style={s.bold}>{formatMoney(invoice.paidAmount)}</Text>
              </View>
            )}
            <View style={s.metaRow}>
              <Text style={s.metaKey}>Balance</Text>
              <Text style={s.bold}>
                {isVoid ? "—" : formatMoney(invoice.balance)}
              </Text>
            </View>
          </View>
        </View>

        {/* Services */}
        <View style={s.section}>
          <Text style={s.label}>Services</Text>
          {invoice.lineItems.length === 0 ? (
            <Text style={s.muted}>No line items linked to this invoice.</Text>
          ) : (
            <>
              <View style={[s.row, s.th]}>
                <Text style={{ width: 60 }}>Date</Text>
                <Text style={{ flexGrow: 1, flexBasis: 0 }}>Description</Text>
                <Text style={[{ width: 40 }, s.right]}>Hrs</Text>
                <Text style={[{ width: 60 }, s.right]}>Rate</Text>
                <Text style={[{ width: 70 }, s.right]}>Amount</Text>
              </View>
              {invoice.lineItems.map((li) => (
                <View key={li.id} style={s.tr} wrap={false}>
                  <Text style={{ width: 60 }}>
                    {formatDateOnly(li.date, "short")}
                  </Text>
                  <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: 8 }}>
                    <Text>{li.activity}</Text>
                    {li.narrative && (
                      <Text style={s.muted}>{li.narrative}</Text>
                    )}
                    <Text style={s.muted}>
                      {li.userName} — {li.userJobTitle}
                    </Text>
                  </View>
                  <Text style={[{ width: 40 }, s.right]}>
                    {li.hours.toFixed(2)}
                  </Text>
                  <Text style={[{ width: 60 }, s.right]}>
                    {li.rate !== null ? formatMoney(li.rate) : "—"}
                  </Text>
                  <Text style={[{ width: 70 }, s.right]}>
                    {li.amount !== null ? formatMoney(li.amount) : "—"}
                  </Text>
                </View>
              ))}
            </>
          )}
        </View>

        {/* Expenses */}
        {invoice.expenseLineItems.length > 0 && (
          <View style={s.section}>
            <Text style={s.label}>Expenses</Text>
            <View style={[s.row, s.th]}>
              <Text style={{ width: 60 }}>Date</Text>
              <Text style={{ flexGrow: 1, flexBasis: 0 }}>Description</Text>
              <Text style={{ width: 90 }}>Category</Text>
              <Text style={[{ width: 70 }, s.right]}>Amount</Text>
            </View>
            {invoice.expenseLineItems.map((ex) => (
              <View key={ex.id} style={s.tr} wrap={false}>
                <Text style={{ width: 60 }}>
                  {formatDateOnly(ex.date, "short")}
                </Text>
                <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: 8 }}>
                  <Text>{ex.description}</Text>
                  {ex.notes && <Text style={s.muted}>{ex.notes}</Text>}
                  {ex.utbmsCode && <Text style={s.muted}>{ex.utbmsCode}</Text>}
                </View>
                <Text style={{ width: 90 }}>
                  {ex.category.replace(/_/g, " ")}
                </Text>
                <Text style={[{ width: 70 }, s.right]}>
                  {formatMoney(ex.amount)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Totals (stored values) */}
        <View style={s.section} wrap={false}>
          <View style={s.totals}>
            <View style={s.totalRow}>
              <Text style={s.muted}>Subtotal</Text>
              <Text>{formatMoney(invoice.subtotal)}</Text>
            </View>
            {invoice.taxAmount > 0 && (
              <View style={s.totalRow}>
                <Text style={s.muted}>Tax</Text>
                <Text>{formatMoney(invoice.taxAmount)}</Text>
              </View>
            )}
            <View style={s.totalFinal}>
              <Text>Total due</Text>
              <Text>
                {isVoid ? "Void — nothing due" : formatMoney(invoice.balance)}
              </Text>
            </View>
          </View>
        </View>

        {/* Payments */}
        {invoice.payments.length > 0 && (
          <View style={s.section}>
            <Text style={s.label}>Payments received</Text>
            <View style={[s.row, s.th]}>
              <Text style={{ width: 60 }}>Date</Text>
              <Text style={{ flexGrow: 1, flexBasis: 0 }}>Source</Text>
              <Text style={{ width: 90 }}>Reference</Text>
              <Text style={[{ width: 70 }, s.right]}>Amount</Text>
            </View>
            {invoice.payments.map((p) => (
              <View key={p.id} style={s.tr} wrap={false}>
                <Text style={{ width: 60 }}>
                  {formatDateOnly(p.date, "short")}
                </Text>
                <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: 8 }}>
                  <Text>
                    {INVOICE_PAYMENT_SOURCE_LABEL[
                      p.source as InvoicePaymentSource
                    ] ?? p.source}
                  </Text>
                  {p.description && <Text style={s.muted}>{p.description}</Text>}
                </View>
                <Text style={{ width: 90 }}>{p.reference ?? "—"}</Text>
                <Text style={[{ width: 70 }, s.right]}>
                  {formatMoney(p.amount)}
                </Text>
              </View>
            ))}
            {gap > 0.005 && (
              <Text style={[s.muted, { marginTop: 4, fontStyle: "italic" }]}>
                An additional {formatMoney(gap)} was applied via Mark paid
                without a recorded transaction.
              </Text>
            )}
          </View>
        )}

        {/* Notes */}
        {invoice.notes && (
          <View style={{ paddingVertical: 10 }}>
            <Text style={s.label}>Notes</Text>
            <Text style={s.muted}>{invoice.notes}</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(
  invoice: InvoiceDetail,
  firm: FirmProfile,
  timeZone: string
): Promise<Buffer> {
  return renderToBuffer(
    <InvoicePdfDocument invoice={invoice} firm={firm} timeZone={timeZone} />
  );
}
