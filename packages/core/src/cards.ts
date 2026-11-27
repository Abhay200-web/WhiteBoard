import { z } from 'zod';

/**
 * Cards live in a board's live document (`cards` map, one Y.Map per card), not in the database.
 * Every card has a place and size on its board. Values are checked when read, so a card that does
 * not match its kind is skipped rather than shown broken.
 */
export const CARD_KINDS = ['note', 'image', 'file', 'link'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

const place = {
  id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
};

export const noteCardSchema = z.object({
  ...place,
  kind: z.literal('note'),
  text: z.string().max(5000),
});

export const imageCardSchema = z.object({
  ...place,
  kind: z.literal('image'),
  fileId: z.string().min(1),
  name: z.string().max(255),
});

export const fileCardSchema = z.object({
  ...place,
  kind: z.literal('file'),
  fileId: z.string().min(1),
  name: z.string().max(255),
  mimeType: z.string().max(255),
});

export const linkCardSchema = z.object({
  ...place,
  kind: z.literal('link'),
  url: z.string().url().max(2048),
  title: z.string().max(300),
  description: z.string().max(1000),
});

export const cardSchema = z.discriminatedUnion('kind', [
  noteCardSchema,
  imageCardSchema,
  fileCardSchema,
  linkCardSchema,
]);
export type Card = z.infer<typeof cardSchema>;

/** What the link preview endpoint returns: the page's title and description, nothing else. */
export const linkPreviewRequestSchema = z.object({
  url: z.string().trim().url().max(2048),
});
export const linkPreviewSchema = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string(),
});
export type LinkPreview = z.infer<typeof linkPreviewSchema>;
