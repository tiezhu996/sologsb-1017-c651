export type RevisionColor = 'white' | 'blue' | 'pink' | 'yellow' | 'green' | 'goldenrod' | 'buff' | 'salmon' | 'cherry'
export type WarningStatus = 'pending' | 'accepted' | 'ignored'
export type WarningType = 'character' | 'prop' | 'wardrobe' | 'timeline'

export interface Character {
  id: string
  name: string
  actor: string
  introducedSceneId: string
  note: string
}

export interface Prop {
  id: string
  name: string
  introducedSceneId: string
  ownerId: string
  note: string
}

export interface Wardrobe {
  id: string
  characterId: string
  name: string
  timePeriods: string[]
  note: string
}

export interface Scene {
  id: string
  number: string
  slug: string
  synopsis: string
  intExt: 'INT' | 'EXT' | 'INT/EXT'
  location: string
  dayNight: string
  storyTime: string
  pageLength: number
  characterIds: string[]
  propIds: string[]
  costumes: Record<string, string>
  revision: RevisionColor
  status: 'draft' | 'review' | 'locked'
  reason: string
}

export interface Script {
  title: string
  writer: string
  draft: string
  scenes: Scene[]
  characters: Character[]
  props: Prop[]
  wardrobes: Wardrobe[]
}

export interface WarningItem {
  id: string
  type: WarningType
  severity: 'error' | 'warning'
  sceneId: string
  title: string
  detail: string
  suggestion: string
}

export interface Reply {
  id: string
  author: string
  text: string
  createdAt: string
}

export interface WarningReview {
  status: WarningStatus
  replies: Reply[]
}

export interface Version {
  id: string
  name: string
  createdAt: string
  script: Script
}

/* ===== 现场交接包：现场状态所有权 =====
 * 包只记录拍摄事实（拍摄日、出场角色、道具、服装更换、备注），
 * 不持有剧本正文（slug/synopsis/intExt/location/pageLength）与修订色。
 * 正文与 revision 永远由本地剧本工作稿掌握，导入/发布不会覆盖它们。
 */

export interface CostumeChange {
  characterId: string
  characterName: string
  wardrobeId: string
  wardrobeName: string
  note: string
}

export interface PackageSceneEntry {
  id: string
  /** 包内场次编号，用于和本地工作稿归位匹配 */
  sceneNumber: string
  /** 打包时该场修订色快照；只有编号+修订色同时命中才自动归位 */
  revision: RevisionColor
  shootDate: string
  characterIds: string[]
  characterNames: string[]
  propIds: string[]
  propNames: string[]
  costumeChanges: CostumeChange[]
  note: string
  /** 最近一次成功写入的本地场次，供重试幂等判断 */
  appliedSceneId?: string
  appliedAt?: string
}

export type PackageStatus = 'draft' | 'ready' | 'publishing' | 'published' | 'failed'

/** 一次发布尝试的检查点：失败后用它回滚，并保证重试不重复追加 */
export interface PublishCheckpoint {
  attemptAt: string
  packageSnapshot: ShootPackage
  sceneIds: string[]
  /** 回滚用：受影响场次发布前的现场记录 */
  recordsBefore: Record<string, ShootSceneRecord>
}

export interface ShootPackage {
  id: string
  name: string
  shootDay: string
  status: PackageStatus
  entries: PackageSceneEntry[]
  createdAt: string
  updatedAt: string
  publishedAt?: string
  lastError?: string
  checkpoint?: PublishCheckpoint
}

/** 写入本地场次上的现场事实；与剧本正文字段严格分离 */
export interface ShootSceneRecord {
  sceneId: string
  shootDate: string
  characterIds: string[]
  propIds: string[]
  costumeChanges: CostumeChange[]
  note: string
  packageId: string
  entryId: string
  appliedAt: string
}

export type ArbitrationReason =
  | 'revision_mismatch' // 编号命中但修订色不一致
  | 'scene_not_found' // 编号在本地稿中不存在
  | 'split_scene' // 同编号对应多个本地场次（原场次已被拆分）
  | 'unresolved_reference' // 角色/道具/服装引用无法在本地资料库落实

export type ArbitrationStatus = 'pending' | 'accepted' | 'rejected'

export interface ArbitrationRecord {
  id: string
  packageId: string
  entryId: string
  reason: ArbitrationReason
  detail: string
  status: ArbitrationStatus
  createdAt: string
  resolvedAt?: string
  resolutionSceneId?: string
}

export interface ContinuityState {
  script: Script
  reviews: Record<string, WarningReview>
  versions: Version[]
  packages: ShootPackage[]
  /** sceneId -> 现场记录（现场状态，不属于剧本正文） */
  sceneRecords: Record<string, ShootSceneRecord>
  arbitrations: ArbitrationRecord[]
  updatedAt: string
}

export interface DiffItem {
  id: string
  sceneNumber: string
  field: string
  before: string
  after: string
}
