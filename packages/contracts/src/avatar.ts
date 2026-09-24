/** Fixed public assets. Anonymous identity is never a selectable account avatar. */
export const PRESET_AVATARS = [
  { id: 'avatar_01', src: '/assets/avatar/runtime/avatar_01.png', label: '头像 1' },
  { id: 'avatar_02', src: '/assets/avatar/runtime/avatar_02.png', label: '头像 2' },
  { id: 'avatar_03', src: '/assets/avatar/runtime/avatar_03.png', label: '头像 3' },
  { id: 'avatar_04', src: '/assets/avatar/runtime/avatar_04.png', label: '头像 4' },
] as const
export const DEFAULT_AVATAR = PRESET_AVATARS[0].src
export const ANONYMOUS_AVATAR = '/assets/avatar/runtime/anonymous.png'

export function isPresetAvatar(value: unknown): value is typeof PRESET_AVATARS[number]['src'] {
  return PRESET_AVATARS.some(item => item.src === value)
}

/** No unreviewed remote images are fetched. Historical values stay in storage. */
export function resolveAvatarSource(value: unknown, anonymous = false): string {
  if (anonymous) return ANONYMOUS_AVATAR
  return isPresetAvatar(value) ? value : DEFAULT_AVATAR
}
