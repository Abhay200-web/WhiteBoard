// Domain types and Zod schemas (the API contract)
export const APP_NAME = 'Whiteboard';

/** Port the Host server listens on (spec §5). */
export const HOST_PORT = 47800;

export * from './auth';
export * from './files';
export * from './host';
export * from './members';
export * from './roles';
