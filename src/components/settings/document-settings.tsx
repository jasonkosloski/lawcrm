/**
 * The Documents settings forms (house style, then paragraph styles). Both
 * save the one DocumentStyle row, so they share a single optimistic-lock
 * token here: a save in either (or a logo change) updates the other.
 */

"use client";

import { useState, type ComponentProps } from "react";
import { DocumentStyleForm } from "./document-style-form";
import { ParagraphStylesForm } from "./paragraph-styles-form";

type Props = {
  houseStyle: Omit<ComponentProps<typeof DocumentStyleForm>, "updatedAt" | "onUpdatedAt">;
  paragraphStyles: Omit<ComponentProps<typeof ParagraphStylesForm>, "updatedAt" | "onUpdatedAt">;
  updatedAt: string;
};

export function DocumentSettings({ houseStyle, paragraphStyles, updatedAt: initial }: Props) {
  const [updatedAt, setUpdatedAt] = useState(initial);
  return (
    <>
      <DocumentStyleForm {...houseStyle} updatedAt={updatedAt} onUpdatedAt={setUpdatedAt} />
      <ParagraphStylesForm {...paragraphStyles} updatedAt={updatedAt} onUpdatedAt={setUpdatedAt} />
    </>
  );
}
