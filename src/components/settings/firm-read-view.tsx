/**
 * Firm Read View — shown to non-admins on /settings/firm.
 *
 * Same data as the edit form but as a flat key/value list with no
 * inputs. The header chip surfaces the user's read-only status so
 * they aren't confused about why the fields aren't editable.
 */

import { Lock } from "lucide-react";
import type { FirmProfile } from "@/lib/firm";

const formatDate = (d: Date | null): string => {
  if (!d) return "—";
  // establishedAt is stored as UTC midnight — render in UTC or the
  // date shifts a day back for viewers west of UTC.
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
};

export function FirmReadView({ firm }: { firm: FirmProfile }) {
  const addressLines = [
    firm.addressLine1,
    firm.addressLine2,
    [firm.city, firm.state, firm.zip].filter(Boolean).join(", "),
    firm.country,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="inline-flex items-center gap-2 text-2xs text-ink-4 px-2.5 py-1 rounded-md border border-line bg-paper-2 self-start">
        <Lock size={11} />
        Read-only — only firm admins can edit this profile.
      </div>

      <Section label="Identity">
        <Row label="Firm name" value={firm.name} />
        <Row label="Short name" value={firm.shortName} />
        <Row label="EIN" value={firm.ein} mono />
        <Row label="Website" value={firm.website} />
        <Row label="Established" value={formatDate(firm.establishedAt)} />
      </Section>

      <Section label="Contact">
        <Row label="Phone" value={firm.phone} mono />
        <Row label="Email" value={firm.email} />
      </Section>

      <Section label="Address">
        {addressLines.length === 0 ? (
          <div className="text-xs text-ink-4">No address on file.</div>
        ) : (
          <div className="text-xs text-ink leading-relaxed">
            {addressLines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
        {label}
      </div>
      <dl className="grid grid-cols-[12rem_1fr] gap-y-1.5 text-xs">
        {children}
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-ink-4">{label}</dt>
      <dd className={mono ? "text-ink font-mono" : "text-ink"}>
        {value ?? "—"}
      </dd>
    </>
  );
}
