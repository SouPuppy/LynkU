import type { database } from 'wx-server-sdk'
import type { ProfileProjectionPorts, ProfileSnapshot } from '@lynku/server'

interface ProjectionDatabase {
  collection(name: 'posts' | 'comments' | 'notifications'): {
    where(condition: object): { update(value: { data: Record<string, unknown> }): Promise<unknown> | string | void }
  }
  command: { and(parts: object[]): object; or(parts: object[]): object; neq(value: boolean): object; lt(value: number): object; exists(value: boolean): object }
}
type CompatibleDatabase<T extends ProjectionDatabase> = T
export type ProjectionSdkCompatibility = CompatibleDatabase<ReturnType<typeof database>>

export function cloudbaseProfileProjection(db: ProjectionDatabase): ProfileProjectionPorts {
  const project = async (collection: 'posts' | 'comments' | 'notifications', ownerField: '_openid' | 'actor._openid', prefix: 'author' | 'actor', profile: ProfileSnapshot) => {
    const _ = db.command
    await db.collection(collection).where(_.and([
      { [ownerField]: profile.owner, anonymous: _.neq(true) },
      _.or([{ [prefix + '.profile_version']: _.exists(false) }, { [prefix + '.profile_version']: _.lt(profile.version) }]),
    ])).update({ data: { [prefix + '.nickname']: profile.nickname, [prefix + '.avatar_url']: profile.avatar_url, [prefix + '.profile_version']: profile.version } })
  }
  return { posts: snapshot => project('posts', '_openid', 'author', snapshot),
    comments: snapshot => project('comments', '_openid', 'author', snapshot),
    notifications: snapshot => project('notifications', 'actor._openid', 'actor', snapshot) }
}
