import { z } from 'zod';

/** A board: the root board of a project, or a board nested inside another one. */
export const boardSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  isRoot: z.boolean(),
  createdBy: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  trashedAt: z.number().nullable(),
});
export type Board = z.infer<typeof boardSchema>;

/** A board placed on another board (its place in the nesting). Cards are added in Step B4. */
export const boardItemSchema = z.object({
  id: z.string(),
  kind: z.literal('board'),
  childBoardId: z.string(),
  title: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type BoardItem = z.infer<typeof boardItemSchema>;

/** One step of the trail shown above a board: the board's name and id. */
export const breadcrumbSchema = z.object({ id: z.string(), title: z.string() });

export const boardDetailSchema = boardSchema.extend({
  /** From the project's root board down to this board (this board last). */
  breadcrumbs: z.array(breadcrumbSchema),
  items: z.array(boardItemSchema),
});
export type BoardDetail = z.infer<typeof boardDetailSchema>;

export const boardListSchema = z.array(boardSchema);

const boardTitle = z.string().trim().min(1, 'Name is required').max(120);

export const createBoardRequestSchema = z.object({
  title: boardTitle.default('Untitled board'),
  x: z.number().finite().default(0),
  y: z.number().finite().default(0),
});
export type CreateBoardRequest = z.infer<typeof createBoardRequestSchema>;

export const updateBoardRequestSchema = z.object({ title: boardTitle });
export type UpdateBoardRequest = z.infer<typeof updateBoardRequestSchema>;

/** Size of a board placed on a board, in board units. */
export const BOARD_ITEM_SIZE = { width: 240, height: 160 } as const;
