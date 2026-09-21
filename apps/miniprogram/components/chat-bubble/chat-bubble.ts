// components/chat-bubble — chat bubble (left/right layout)
import { formatTime } from '../../utils/util'

Component({
  data: {
    displayTime: '',
    displayStatus: '',
  },

  properties: {
    message: {
      type: Object,
      value: null,
      observer(message: { created_at?: string; status?: string } | null) {
        const labels: Record<string, string> = { sent: '已发送', delivered: '已送达', read: '已读' }
        this.setData({
          displayTime: message && message.created_at ? formatTime(message.created_at) : '',
          displayStatus: message ? labels[message.status || ''] || '' : '',
        })
      },
    }, // {fromId, content, status, createdAt}
    mine: { type: Boolean, value: false },  // true = right-aligned (my message)
  },

  methods: {},
})
