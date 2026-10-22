/**
 * The fixed sample letter body shown in the Settings → Documents live
 * preview: two paragraphs and a signature-ish closing. Rendered with
 * renderTemplate against SAMPLE_TEMPLATE_DATA so field values are fake.
 */

import type { TemplateDoc } from "./schema";

export const SAMPLE_LETTER_DOC: TemplateDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Dear Client," }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Thank you for meeting with us. This sample shows how a letter will look in your firm's house style: the font, size, spacing and margins you choose here apply to every letter and filing you generate.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Please call if you have any questions. We will be in touch as soon as we have an update.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Sincerely," },
        { type: "hardBreak" },
        { type: "hardBreak" },
        { type: "field", attrs: { path: "user.name", format: null } },
      ],
    },
  ],
};
