import { ViewScope } from '../features/session/view-scope'
import * as session from '../services/session'

export function createViewScope(changed: (visible: boolean) => void): ViewScope {
  return new ViewScope({ revision: session.getRevision, subscribe: session.onChange }, changed)
}
