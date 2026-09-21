import { EditorController, type EditorObserver, type EditorRoute } from '../features/editor/index'
import { editorStorage } from '../platform/editor-storage'
import { createPost, updatePost, getPost } from '../services/posts'
import { listCategories } from '../services/categories'
import { saveDraft, listDrafts } from '../services/drafts'
import { enqueueDraftCleanup, flushDraftCleanup } from '../services/draft-cleanup'
import * as session from '../services/session'
import * as anonymous from '../services/anonymous'
import { createRequestId } from '../utils/util'

export function createEditor(route: EditorRoute, observer: EditorObserver): EditorController {
  return new EditorController(route, {
    session: {
      current: () => ({ owner: session.getOpenid(), revision: session.getRevision(), verified: session.getState() === 'verified' }),
      subscribe: session.onChange,
    },
    content: {
      categories: listCategories, post: id => getPost(id, true), drafts: listDrafts, saveDraft,
      create: createPost, update: updatePost, enqueueCleanup: enqueueDraftCleanup, flushCleanup: flushDraftCleanup,
    },
    recovery: editorStorage,
    anonymous: { get: anonymous.isAnonymous, set: value => { if (value !== anonymous.isAnonymous()) anonymous.toggle() } },
    requestId: createRequestId,
    schedule: (delay, action) => { const timer = setTimeout(action, delay); return () => clearTimeout(timer) },
  }, observer)
}
