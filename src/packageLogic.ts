import type {
  ArbitrationReason,
  CostumeChange,
  PackageSceneEntry,
  RevisionColor,
  Scene,
  Script,
  ShootPackage,
  ShootSceneRecord
} from './types'

export const PACKAGE_FILE_VERSION = 1
const entryId = () => `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/** 从当前本地工作稿生成现场交接包：只抽取拍摄事实，正文与修订色留在本地。 */
export function createPackageFromScript(script: Script, name: string, shootDay: string): ShootPackage {
  const now = new Date().toISOString()
  const entries: PackageSceneEntry[] = script.scenes.map((scene) => {
    const characters = scene.characterIds
      .map((id) => script.characters.find((item) => item.id === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    const props = scene.propIds
      .map((id) => script.props.find((item) => item.id === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    const costumeChanges: CostumeChange[] = Object.entries(scene.costumes).map(([characterId, wardrobeId]) => {
      const character = script.characters.find((item) => item.id === characterId)
      const wardrobe = script.wardrobes.find((item) => item.id === wardrobeId)
      return {
        characterId,
        characterName: character?.name ?? '未知角色',
        wardrobeId,
        wardrobeName: wardrobe?.name ?? '未知服装',
        note: ''
      }
    })
    return {
      id: entryId(),
      sceneNumber: scene.number,
      revision: scene.revision,
      shootDate: shootDay,
      characterIds: characters.map((item) => item.id),
      characterNames: characters.map((item) => item.name),
      propIds: props.map((item) => item.id),
      propNames: props.map((item) => item.name),
      costumeChanges,
      note: ''
    }
  })
  return {
    id: newId('pkg'),
    name: name.trim() || `拍摄日 ${shootDay} 交接包`,
    shootDay,
    status: 'ready',
    entries,
    createdAt: now,
    updatedAt: now
  }
}

export function serializePackage(pkg: ShootPackage): string {
  return JSON.stringify({ fileType: 'continuity-shoot-package', version: PACKAGE_FILE_VERSION, package: pkg }, null, 2)
}

export function parsePackageFile(raw: string): ShootPackage {
  const parsed = JSON.parse(raw) as { fileType?: string; package?: ShootPackage }
  const pkg = parsed.package ?? (parsed as unknown as ShootPackage)
  if (!pkg || !Array.isArray(pkg.entries) || typeof pkg.id !== 'string') {
    throw new Error('文件不是有效的现场交接包。')
  }
  return pkg
}

export type EntryClassification =
  | { kind: 'match'; sceneId: string }
  | { kind: 'arbitration'; reason: ArbitrationReason; detail: string }

/** 归位规则：按场次编号 + 修订色。编号缺失、修订色不一致或指向已拆分场次都进入待裁决。 */
export function classifyEntry(entry: PackageSceneEntry, script: Script): EntryClassification {
  const numbered = script.scenes.filter((scene) => scene.number.trim() === entry.sceneNumber.trim())
  if (numbered.length === 0) {
    return { kind: 'arbitration', reason: 'scene_not_found', detail: `本地工作稿没有编号为 ${entry.sceneNumber} 的场次，可能已删除或重新编号。` }
  }
  if (numbered.length > 1) {
    return { kind: 'arbitration', reason: 'split_scene', detail: `编号 ${entry.sceneNumber} 在本地对应 ${numbered.length} 个场次，原场次可能已拆分，需人工指定归属。` }
  }
  const scene = numbered[0]
  if (scene.revision !== entry.revision) {
    return { kind: 'arbitration', reason: 'revision_mismatch', detail: `场次 ${entry.sceneNumber} 包内修订色为 ${revisionLabel(entry.revision)}，本地稿为 ${revisionLabel(scene.revision)}。保留本地正文，等待裁决。` }
  }
  const missingRefs = unresolvedReferences(entry, script)
  if (missingRefs.length) {
    return { kind: 'arbitration', reason: 'unresolved_reference', detail: `场次 ${entry.sceneNumber} 有引用无法在本地资料库落实：${missingRefs.join('、')}。` }
  }
  return { kind: 'match', sceneId: scene.id }
}

export function unresolvedReferences(entry: PackageSceneEntry, script: Script): string[] {
  const missing: string[] = []
  entry.characterIds.forEach((id, index) => {
    if (!script.characters.some((item) => item.id === id || item.name === entry.characterNames[index])) {
      missing.push(`角色“${entry.characterNames[index] ?? id}”`)
    }
  })
  entry.propIds.forEach((id, index) => {
    if (!script.props.some((item) => item.id === id || item.name === entry.propNames[index])) {
      missing.push(`道具“${entry.propNames[index] ?? id}”`)
    }
  })
  entry.costumeChanges.forEach((change) => {
    const character = script.characters.find((item) => item.id === change.characterId || item.name === change.characterName)
    const wardrobe = script.wardrobes.find((item) => item.id === change.wardrobeId || item.name === change.wardrobeName)
    if (!character) missing.push(`换装角色“${change.characterName}”`)
    if (!wardrobe) missing.push(`服装“${change.wardrobeName}”`)
  })
  return [...new Set(missing)]
}

/** 把包内引用解析到本地资料库 id（优先 id，其次按名称），无法落实的引用丢弃。 */
export function resolveEntryToLocal(entry: PackageSceneEntry, script: Script) {
  const characterIds = entry.characterIds
    .map((id, index) => script.characters.find((item) => item.id === id || item.name === entry.characterNames[index]))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => item.id)
  const propIds = entry.propIds
    .map((id, index) => script.props.find((item) => item.id === id || item.name === entry.propNames[index]))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => item.id)
  const costumeChanges: CostumeChange[] = entry.costumeChanges.flatMap((change) => {
    const character = script.characters.find((item) => item.id === change.characterId || item.name === change.characterName)
    const wardrobe = script.wardrobes.find((item) => item.id === change.wardrobeId || item.name === change.wardrobeName)
    if (!character || !wardrobe) return []
    return [{ characterId: character.id, characterName: character.name, wardrobeId: wardrobe.id, wardrobeName: wardrobe.name, note: change.note }]
  })
  return { characterIds: [...new Set(characterIds)], propIds: [...new Set(propIds)], costumeChanges }
}

/** 幂等写入：同 entryId 覆盖同一场，不重复追加；换场则清掉旧场记录。 */
export function applyEntryToRecord(
  records: Record<string, ShootSceneRecord>,
  entry: PackageSceneEntry,
  target: Scene,
  script: Script,
  packageId: string
): Record<string, ShootSceneRecord> {
  const next = { ...records }
  // 该条目之前可能写到别的场次（人工改判/重试），先移除旧归属，保证只保留一份。
  Object.keys(next).forEach((sceneId) => {
    if (next[sceneId].packageId === packageId && next[sceneId].entryId === entry.id) delete next[sceneId]
  })
  const resolved = resolveEntryToLocal(entry, script)
  next[target.id] = {
    sceneId: target.id,
    shootDate: entry.shootDate,
    ...resolved,
    note: entry.note,
    packageId,
    entryId: entry.id,
    appliedAt: new Date().toISOString()
  }
  return next
}

export function arbitrationReasonLabel(reason: ArbitrationReason): string {
  switch (reason) {
    case 'revision_mismatch': return '修订色不一致'
    case 'scene_not_found': return '场次不存在'
    case 'split_scene': return '场次已拆分'
    case 'unresolved_reference': return '引用无法落实'
  }
}

export function revisionLabel(revision: RevisionColor): string {
  const labels: Record<RevisionColor, string> = {
    white: '白纸', blue: '蓝', pink: '粉', yellow: '黄', green: '绿',
    goldenrod: '金菊', buff: '浅黄', salmon: '鲑粉', cherry: '樱桃'
  }
  return labels[revision]
}

export function packageStatusLabel(status: ShootPackage['status']): string {
  switch (status) {
    case 'draft': return '编辑中'
    case 'ready': return '待发布'
    case 'publishing': return '发布中'
    case 'published': return '已发布'
    case 'failed': return '发布失败'
  }
}
