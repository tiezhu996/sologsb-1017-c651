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

/* ===================== 现场交接包（现场侧所有权） =====================
 * 包里只记录拍摄事实：拍摄日、出场角色、道具、服装更换、备注。
 * 不包含剧本正文，也不掌握修订色归属——修订色仅作为归位匹配线索。
 * 本地稿始终掌握正文与修订色，导入冲突时保留本地内容。 */

export interface WardrobeChange {
  id: string
  characterId: string
  wardrobeId: string
  note: string
}

export interface HandoffEntry {
  id: string
  sceneNumber: string
  revision: RevisionColor
  shootDate: string
  characterIds: string[]
  propIds: string[]
  wardrobeChanges: WardrobeChange[]
  notes: string
}

export interface HandoffPackage {
  id: string
  name: string
  preparedAt: string
  entries: HandoffEntry[]
}

export type ArbitrationReason =
  | 'number-not-found' // 本地稿查无此场号（现场新增或编号写法不同）
  | 'revision-mismatch' // 编号唯一但修订色不一致，保留本地
  | 'split-scene' // 该编号在本地稿指向多个已拆分场次
  | 'duplicate-entry' // 同包内同编号+同修订色出现多条

export interface ArbitrationRecord {
  id: string
  packageId: string
  packageName: string
  entryId: string
  sceneNumber: string
  revision: RevisionColor
  shootDate: string
  characterIds: string[]
  propIds: string[]
  wardrobeChanges: WardrobeChange[]
  notes: string
  reason: ArbitrationReason
  candidateSceneIds: string[]
  localRevision: RevisionColor | null
  createdAt: string
  status: 'pending' | 'attached' | 'discarded'
  resolvedSceneId?: string
  resolvedAt?: string
}

export interface AttachedHandoff {
  id: string
  packageId: string
  packageName: string
  entryId: string
  shootDate: string
  revision: RevisionColor
  characterIds: string[]
  propIds: string[]
  wardrobeChanges: WardrobeChange[]
  notes: string
  attachedAt: string
  viaArbitration: boolean
}

export interface PublishCheckpoint {
  id: string
  packageId: string
  packageName: string
  requestHash: string
  attempt: number
  failedAt: string
  reason: string
  resolvedAt?: string
}

export interface PublishLogEntry {
  id: string
  requestHash: string
  packageId: string
  packageName: string
  attempt: number
  status: 'failed' | 'success'
  duplicate: boolean
  detail: string
  at: string
}

export type PublishPhase =
  | { phase: 'idle' }
  | { phase: 'publishing'; packageId: string; requestHash: string; attempt: number; startedAt: string }
  | { phase: 'failed'; packageId: string; requestHash: string; attempt: number; checkpointId: string; reason: string; failedAt: string }
  | { phase: 'success'; packageId: string; requestHash: string; attempt: number; duplicate: boolean; at: string }

export interface HandoffState {
  draft: HandoffPackage
  packages: HandoffPackage[] // 已组包快照（失败时冻结留存）
  lastPublishedPackage: HandoffPackage | null // 上一包
  publish: PublishPhase
  log: PublishLogEntry[]
  checkpoints: PublishCheckpoint[]
  attached: Record<string, AttachedHandoff[]> // 按本地场次 id 归位
  arbitration: ArbitrationRecord[]
  importedEntryIds: string[]
}

export interface ContinuityState {
  script: Script
  reviews: Record<string, WarningReview>
  versions: Version[]
  handoff: HandoffState
  updatedAt: string
}

export interface DiffItem {
  id: string
  sceneNumber: string
  field: string
  before: string
  after: string
}
