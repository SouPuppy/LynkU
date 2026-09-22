/** Stable failure classification shared by text-writing ports and their adapters. */
export class ModerationFailure extends Error {
  constructor(readonly code: 'CONTENT_REJECTED' | 'MODERATION_UNAVAILABLE') { super(code) }
}
export * from './account-capability'
