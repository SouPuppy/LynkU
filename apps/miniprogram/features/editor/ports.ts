import type { Draft, PostMutationReceipt, SaveDraftRequest } from '../../generated/contracts/index'
import type { EditorRecovery } from './recovery'

export interface EditorCategory { _id: string; name: string }
export interface EditablePost { title: string; content: string; category_id: string; anonymous: boolean; revision: number }
export interface PublicationInput { title: string; content: string; category_id: string }
export interface EditorSession { owner: string | null; revision: number; verified: boolean }

/** The editor owns orchestration; these capabilities own platform and API access. */
export interface EditorPorts {
  session: { current(): EditorSession; subscribe(listener: () => void): () => void }
  content: {
    categories(): Promise<EditorCategory[]>
    post(id: string): Promise<EditablePost | null>
    drafts(): Promise<Draft[]>
    saveDraft(request: SaveDraftRequest): Promise<Draft>
    create(input: PublicationInput, anonymous: boolean, requestId: string): Promise<PostMutationReceipt>
    update(id: string, input: PublicationInput, anonymous: boolean, revision: number): Promise<PostMutationReceipt>
    enqueueCleanup(id: string, revision: number): void
    flushCleanup(): Promise<void>
  }
  recovery: { read(owner: string): unknown; write(owner: string, value: EditorRecovery): void; remove(owner: string): void }
  anonymous: { get(): boolean; set(value: boolean): void }
  requestId(): string
  schedule(delayMs: number, action: () => void): () => void
}
