import { profileSnapshot, type ProfileSnapshot } from '../identity/index'

export interface ProfileProjectionPorts {
  posts(snapshot: ProfileSnapshot): Promise<void>
  comments(snapshot: ProfileSnapshot): Promise<void>
  notifications(snapshot: ProfileSnapshot): Promise<void>
}
/** Each destination performs a monotonic conditional write; replay after partial failure converges. */
export async function projectAccountProfile(ports: ProfileProjectionPorts, owner: string, currentAccount: unknown): Promise<void> {
  const snapshot = profileSnapshot(currentAccount, owner)
  await Promise.all([ports.posts(snapshot), ports.comments(snapshot), ports.notifications(snapshot)])
}
