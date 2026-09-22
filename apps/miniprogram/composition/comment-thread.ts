import { CommentThreadController, type CommentThreadState } from '../features/content/index'
import { listCommentsByPost, syncCommentChanges } from '../services/comments'
import { getRevision, onChange } from '../services/session'

export function createCommentThread(render: (state: CommentThreadState) => void): CommentThreadController {
  return new CommentThreadController({ revision: getRevision, subscribe: onChange }, {
    history: listCommentsByPost, changes: syncCommentChanges,
    repeat: work => { const timer = setInterval(work, 6000); return () => clearInterval(timer) },
  }, render)
}
