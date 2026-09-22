import { PostListController, type PostListState } from '../features/content/index'
import { listPosts, searchPosts } from '../services/posts'
import { getRevision, onChange } from '../services/session'

export function createPostList(mode: 'feed' | 'author' | 'search', render: (state: PostListState) => void): PostListController {
  return new PostListController({ revision: getRevision, subscribe: onChange }, (filter, cursor) => mode === 'search'
    ? searchPosts(filter, cursor)
    : listPosts({ ...(mode === 'feed' ? { categoryId: filter } : { authorOpenid: filter }), cursor }), render)
}
