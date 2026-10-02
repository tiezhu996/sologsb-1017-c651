import type { ArbitrationReason, HandoffPackage, RevisionColor, Scene, Script } from './types'

/* 交接包正文指纹：用于幂等发布。重试同一包必须得到同一 requestHash。 */
export function packageRequestHash(pkg: Pick<HandoffPackage, 'id' | 'entries'>): string {
  const canonical = JSON.stringify({
    id: pkg.id,
    entries: pkg.entries
      .map((entry) => ({
        n: entry.sceneNumber.trim(),
        r: entry.revision,
        d: entry.shootDate,
        c: [...entry.characterIds].sort(),
        p: [...entry.propIds].sort(),
        w: entry.wardrobeChanges
          .map((change) => `${change.characterId}>${change.wardrobeId}@${change.note}`)
          .sort(),
        note: entry.notes.trim()
      }))
      .sort((a, b) => (a.n === b.n ? a.r.localeCompare(b.r) : a.n.localeCompare(b.n)))
  })
  let hash = 5381
  for (let i = 0; i < canonical.length; i += 1) hash = ((hash << 5) + hash + canonical.charCodeAt(i)) >>> 0
  return `req-${hash.toString(36)}`
}

export interface ImportPlanItem {
  kind: 'attach'
  sceneId: string
  sceneNumber: string
}

export interface ImportSkipItem {
  kind: 'skip'
  sceneNumber: string
}

export interface ImportConflictItem {
  kind: 'conflict'
  reason: ArbitrationReason
  candidateSceneIds: string[]
  localRevision: RevisionColor | null
  sceneNumber: string
}

export interface ImportPlan {
  items: Array<ImportPlanItem | ImportSkipItem | ImportConflictItem>
}

/* 导入按场次编号 + 修订色归位；编号缺失、修订色不一致或编号指向已拆分场次时不自动归位。 */
export function planImport(pkg: HandoffPackage, script: Script, alreadyImported: string[]): ImportPlan {
  const byNumber = new Map<string, Scene[]>()
  script.scenes.forEach((scene) => {
    const list = byNumber.get(scene.number.trim()) ?? []
    list.push(scene)
    byNumber.set(scene.number.trim(), list)
  })

  const seenKeys = new Set<string>()
  const items: Array<ImportPlanItem | ImportSkipItem | ImportConflictItem> = []

  pkg.entries.forEach((entry) => {
    if (alreadyImported.includes(entry.id)) {
      items.push({ kind: 'skip', sceneNumber: entry.sceneNumber })
      return
    }
    const key = `${entry.sceneNumber.trim()}|${entry.revision}`
    const duplicate = seenKeys.has(key)
    seenKeys.add(key)

    const matches = byNumber.get(entry.sceneNumber.trim())
    if (duplicate) {
      items.push({
        kind: 'conflict',
        reason: 'duplicate-entry',
        candidateSceneIds: (matches ?? []).map((scene) => scene.id),
        localRevision: matches?.length === 1 ? matches[0].revision : null,
        sceneNumber: entry.sceneNumber
      })
      return
    }
    if (!matches || matches.length === 0) {
      items.push({ kind: 'conflict', reason: 'number-not-found', candidateSceneIds: [], localRevision: null, sceneNumber: entry.sceneNumber })
      return
    }
    if (matches.length > 1) {
      // 该编号已拆分：即使修订色命中其中一个，也交人裁决，避免错误覆盖作者拆分意图。
      items.push({
        kind: 'conflict',
        reason: 'split-scene',
        candidateSceneIds: matches.map((scene) => scene.id),
        localRevision: null,
        sceneNumber: entry.sceneNumber
      })
      return
    }
    const scene = matches[0]
    if (scene.revision !== entry.revision) {
      items.push({
        kind: 'conflict',
        reason: 'revision-mismatch',
        candidateSceneIds: [scene.id],
        localRevision: scene.revision,
        sceneNumber: entry.sceneNumber
      })
      return
    }
    items.push({ kind: 'attach', sceneId: scene.id, sceneNumber: scene.number })
  })

  return { items }
}

export const arbitrationReasonLabel: Record<ArbitrationReason, string> = {
  'number-not-found': '本地稿查无此场号',
  'revision-mismatch': '修订色与本地稿不一致',
  'split-scene': '该场号已拆分为多个场次',
  'duplicate-entry': '交接包内同场号同色重复'
}

export const arbitrationReasonHint: Record<ArbitrationReason, string> = {
  'number-not-found': '可能是现场新增场次或编号写法不同，正文未被改动。',
  'revision-mismatch': '本地修订色为准；现场记录可手动挂到该场作为事实留档。',
  'split-scene': '作者已把此场拆分，请确认现场记录应挂到哪一场。',
  'duplicate-entry': '同一包内出现多条同编号同色记录，请人工确认归属。'
}
