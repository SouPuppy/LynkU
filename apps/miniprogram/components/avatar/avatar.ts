// components/avatar — avatar with default fallback
const DEFAULT = '/assets/default-avatar.png'
const ANONYMOUS = '/assets/anonymous.png'

Component({
  properties: {
    src: { type: String, value: '' },
    size: { type: String, value: 'md' }, // sm | md | lg
    anonymous: { type: Boolean, value: false },
  },

  data: {
    displaySrc: DEFAULT,
  },

  observers: {
    'src, anonymous'(src: string, anonymous: boolean) {
      this.setData({ displaySrc: anonymous ? ANONYMOUS : (src || DEFAULT) })
    },
  },

  methods: {
    onError() {
      this.setData({ displaySrc: this.properties.anonymous ? ANONYMOUS : DEFAULT })
    },
  },
})
