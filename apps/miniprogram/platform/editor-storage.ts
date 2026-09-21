import { recoveryKey } from '../features/editor/recovery'
import type { EditorPorts } from '../features/editor/index'

export const editorStorage: EditorPorts['recovery'] = {
  read: owner => wx.getStorageSync(recoveryKey(owner)),
  write: (owner, value) => { wx.setStorageSync(recoveryKey(owner), value) },
  remove: owner => { wx.removeStorageSync(recoveryKey(owner)) },
}
