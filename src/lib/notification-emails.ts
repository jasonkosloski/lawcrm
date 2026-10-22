/**
 * Staff notification emails: one per notification (Instant) or one
 * daily summary (Digest). Staff mail goes to the firm's own staff
 * addresses, so titles may name matters (unlike portal client emails).
 * Links in notification rows are app-relative; `baseUrl` (the staff
 * origin from `staffAppUrl()`) makes them absolute.
 */

import type { OutgoingEmail } from "@/lib/email/drivers";
import { escapeHtml as esc } from "@/lib/email/escape";
import { NOTIFICATION_CATEGORIES, categoryOf } from "@/lib/notification-categories";

type Body = Omit<OutgoingEmail, "to">;

export type EmailItem = {
  title: string;
  body: string | null;
  link: string | null;
  type: string;
};

const absolute = (link: string, baseUrl: string) =>
  /^https?:\/\//.test(link) ? link : `${baseUrl}${link.startsWith("/") ? "" : "/"}${link}`;

const settingsUrl = (baseUrl: string) => `${baseUrl}/settings/notifications`;

const footerHtml = (baseUrl: string) =>
  `<p style="color:#666;font-size:12px"><a href="${esc(settingsUrl(baseUrl))}">Change email notification settings</a></p>`;

const footerText = (baseUrl: string) =>
  `Change email notification settings: ${settingsUrl(baseUrl)}`;

export function instantNotificationEmail(item: EmailItem, baseUrl: string): Body {
  const url = item.link ? absolute(item.link, baseUrl) : null;
  const text = [
    item.title,
    item.body,
    url ? `Open in LitGox: ${url}` : null,
    "",
    footerText(baseUrl),
  ]
    .filter((l) => l !== null)
    .join("\n\n");
  const html = [
    `<p><strong>${esc(item.title)}</strong></p>`,
    item.body ? `<p>${esc(item.body)}</p>` : "",
    url ? `<p><a href="${esc(url)}">Open in LitGox</a></p>` : "",
    footerHtml(baseUrl),
  ].join("");
  return { subject: item.title, text, html };
}

export function digestNotificationEmail(items: EmailItem[], baseUrl: string): Body {
  const n = items.length;
  const textParts: string[] = [];
  const htmlParts: string[] = [];
  for (const cat of NOTIFICATION_CATEGORIES) {
    const group = items.filter((i) => categoryOf(i.type) === cat.key);
    if (group.length === 0) continue;
    textParts.push(cat.label.toUpperCase());
    htmlParts.push(`<h2>${esc(cat.label)}</h2><ul>`);
    for (const i of group) {
      const url = i.link ? absolute(i.link, baseUrl) : null;
      textParts.push(
        [`- ${i.title}`, i.body ? `  ${i.body}` : null, url ? `  ${url}` : null]
          .filter((l) => l !== null)
          .join("\n"),
      );
      const title = url ? `<a href="${esc(url)}">${esc(i.title)}</a>` : esc(i.title);
      htmlParts.push(
        `<li>${title}${i.body ? `<br><span style="color:#555">${esc(i.body)}</span>` : ""}</li>`,
      );
    }
    htmlParts.push("</ul>");
  }
  return {
    subject: `Your daily summary: ${n} notification${n === 1 ? "" : "s"}`,
    text: [...textParts, "", footerText(baseUrl)].join("\n\n"),
    html: htmlParts.join("") + footerHtml(baseUrl),
  };
}
