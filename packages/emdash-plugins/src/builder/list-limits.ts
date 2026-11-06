import type { PageDocument } from './document.ts';

/** A list query returns at most this many entries, and this many when it sets no limit. */
export const maxListItems = 24;
export const defaultListItems = 6;

/** How many copies a repeat over this data source renders at most. */
export function listLength(document: PageDocument, source: string): number {
  return document.data?.[source]?.limit ?? defaultListItems;
}
