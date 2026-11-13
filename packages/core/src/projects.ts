import { z } from 'zod';

export const PROJECT_STATUSES = ['draft', 'active', 'in_review', 'delivered', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Which status a project may move to next (spec: draft -> active -> in review -> delivered -> archived). */
export const PROJECT_STATUS_FLOW: Record<ProjectStatus, readonly ProjectStatus[]> = {
  draft: ['active', 'archived'],
  active: ['in_review', 'delivered', 'archived'],
  in_review: ['active', 'delivered', 'archived'],
  delivered: ['active', 'archived'],
  archived: ['active'],
};

export const PROJECT_MEMBER_ROLES = ['manager', 'artist'] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

export const PROJECT_FILE_KINDS = ['reference', 'brief', 'other'] as const;
export type ProjectFileKind = (typeof PROJECT_FILE_KINDS)[number];

export const TASK_STATUS_KINDS = [
  'todo',
  'doing',
  'review',
  'changes',
  'approved',
  'done',
] as const;
export type TaskStatusKind = (typeof TASK_STATUS_KINDS)[number];

/** Every new project is seeded with one status per kind (spec section 6). */
export const DEFAULT_TASK_STATUSES: readonly { name: string; kind: TaskStatusKind }[] = [
  { name: 'To do', kind: 'todo' },
  { name: 'In progress', kind: 'doing' },
  { name: 'In review', kind: 'review' },
  { name: 'Changes requested', kind: 'changes' },
  { name: 'Approved', kind: 'approved' },
  { name: 'Done', kind: 'done' },
];

/** A rich-text document (TipTap/ProseMirror JSON). The server stores it as given. */
export const richTextSchema = z.record(z.string(), z.unknown());
export type RichText = z.infer<typeof richTextSchema>;

const COLOR = /^#[0-9a-fA-F]{6}$/;

export const projectMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(PROJECT_MEMBER_ROLES),
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  clientName: z.string().nullable(),
  status: z.enum(PROJECT_STATUSES),
  startDate: z.number().int().nullable(),
  deadline: z.number().int().nullable(),
  budget: z.number().int().nullable(),
  color: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.number().int(),
  memberCount: z.number().int(),
  /** The signed-in user's role in the project; `null` for admins who are not members. */
  myRole: z.enum(PROJECT_MEMBER_ROLES).nullable(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectDetailSchema = projectSchema.extend({
  brief: richTextSchema.nullable(),
  instructions: richTextSchema.nullable(),
  members: z.array(projectMemberSchema),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const projectListSchema = z.array(projectSchema);

const projectFields = {
  name: z.string().trim().min(1, 'Name is required').max(120),
  clientName: z.string().trim().max(120).nullable(),
  brief: richTextSchema.nullable(),
  instructions: richTextSchema.nullable(),
  startDate: z.number().int().nullable(),
  deadline: z.number().int().nullable(),
  budget: z.number().int().nonnegative().nullable(),
  color: z.string().regex(COLOR, 'Use a colour like #3366cc').nullable(),
};

export const createProjectRequestSchema = z
  .object({ name: projectFields.name })
  .extend({
    clientName: projectFields.clientName.optional(),
    brief: projectFields.brief.optional(),
    instructions: projectFields.instructions.optional(),
    startDate: projectFields.startDate.optional(),
    deadline: projectFields.deadline.optional(),
    budget: projectFields.budget.optional(),
    color: projectFields.color.optional(),
  })
  .refine(
    (v) => v.startDate == null || v.deadline == null || v.deadline >= v.startDate,
    'The deadline cannot be before the start date',
  );
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z
  .object({
    name: projectFields.name,
    clientName: projectFields.clientName,
    brief: projectFields.brief,
    instructions: projectFields.instructions,
    startDate: projectFields.startDate,
    deadline: projectFields.deadline,
    budget: projectFields.budget,
    color: projectFields.color,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const setProjectStatusRequestSchema = z.object({ status: z.enum(PROJECT_STATUSES) });

export const addProjectMemberRequestSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(PROJECT_MEMBER_ROLES),
});
export type AddProjectMemberRequest = z.infer<typeof addProjectMemberRequestSchema>;

/** `GET /people` — who can be added to a project (staff and freelancers of this Host). */
export const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['owner', 'admin', 'member', 'guest']),
});
export type Person = z.infer<typeof personSchema>;
export const personListSchema = z.array(personSchema);

export const projectFileSchema = z.object({
  fileId: z.string(),
  kind: z.enum(PROJECT_FILE_KINDS),
  addedBy: z.string(),
  addedAt: z.number().int(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  hasThumbnail: z.boolean(),
});
export type ProjectFile = z.infer<typeof projectFileSchema>;
export const projectFileListSchema = z.array(projectFileSchema);

export const attachProjectFileRequestSchema = z.object({
  fileId: z.string().min(1),
  kind: z.enum(PROJECT_FILE_KINDS).default('reference'),
});
