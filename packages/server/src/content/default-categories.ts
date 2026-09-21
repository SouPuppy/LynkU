/** Initial product categories, shared by the admin seed use case and environment setup. */
export const DEFAULT_CATEGORIES: ReadonlyArray<{
  readonly name: string
  readonly description: string
  readonly sort_order: number
}> = [
  { name: '学术讨论', description: '课程、考试、科研相关', sort_order: 1 },
  { name: '校园生活', description: '食堂、宿舍、社团活动', sort_order: 2 },
  { name: '实习就业', description: '招聘信息、面试经验', sort_order: 3 },
  { name: '留学申请', description: '2+2、交换、研究生申请', sort_order: 4 },
  { name: '吃喝玩乐', description: '周边美食、旅游攻略', sort_order: 5 },
]
