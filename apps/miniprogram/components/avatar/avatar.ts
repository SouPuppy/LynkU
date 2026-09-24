import { DEFAULT_AVATAR, resolveAvatarSource } from '../../generated/contracts/index'

Component({
  properties: {
    src: { type: String, value: '' },
    size: { type: String, value: 'md' }, // sm | md | lg
    anonymous: { type: Boolean, value: false },
  },

  data: {
    displaySrc: '',
    generation: 0,
    frames: [] as { src: string; generation: number }[],
  },

  observers: {
    'src, anonymous'(src: string, anonymous: boolean) {
      this.showSource(resolveAvatarSource(src, anonymous))
    },
  },

  lifetimes: {
    attached() { this.showSource(resolveAvatarSource(this.properties.src, this.properties.anonymous)) },
  },

  methods: {
    showSource(src: string) {
      const generation = this.data.generation + 1
      this.setData({ displaySrc: src, generation, frames: [{ src, generation }] })
    },
    onError(e: WechatMiniprogram.CustomEvent) {
      if (Number(e.currentTarget.dataset.generation) !== this.data.generation) return
      if (this.properties.anonymous || this.data.displaySrc === DEFAULT_AVATAR) {
        this.setData({ displaySrc: '', frames: [], generation: this.data.generation + 1 })
      } else this.showSource(DEFAULT_AVATAR)
    },
  },
})
