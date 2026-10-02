import { useCallback, useEffect, useRef, useState } from 'react'
import { sampleScript } from './sample'
import {
  applyEntryToRecord,
  classifyEntry,
  createPackageFromScript,
  newId,
  parsePackageFile
} from './packageLogic'
import type {
  ArbitrationRecord,
  Character,
  ContinuityState,
  DiffItem,
  PackageSceneEntry,
  Prop,
  Reply,
  Scene,
  Script,
  ShootPackage,
  ShootSceneRecord,
  Version,
  Wardrobe,
  WarningItem,
  WarningReview
} from './types'

const STORAGE_KEY = 'sologsb-1017-continuity-v1'
const clone = <T,>(value: T): T => structuredClone(value)
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

function withDefaults(raw: Partial<ContinuityState> | null): ContinuityState | null {
  if (!raw || !raw.script?.scenes?.length) return null
  return {
    script: raw.script,
    reviews: raw.reviews ?? {},
    versions: raw.versions ?? [],
    packages: raw.packages ?? [],
    sceneRecords: raw.sceneRecords ?? {},
    arbitrations: raw.arbitrations ?? [],
    updatedAt: raw.updatedAt ?? new Date().toISOString()
  }
}

function initialState(): ContinuityState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const migrated = withDefaults(JSON.parse(raw) as Partial<ContinuityState>)
      if (migrated) return migrated
    }
  } catch {
    // Ignore an invalid local draft and restore the bundled example.
  }
  return { script: clone(sampleScript), reviews: {}, versions: [], packages: [], sceneRecords: {}, arbitrations: [], updatedAt: new Date().toISOString() }
}

export function deriveWarnings(script: Script): WarningItem[] {
  const warnings: WarningItem[] = []
  const sceneIndex = (sceneId: string) => script.scenes.findIndex((scene) => scene.id === sceneId)
  const charactersSeen = new Set<string>()
  const propsSeen = new Set<string>()

  script.scenes.forEach((scene, index) => {
    scene.characterIds.forEach((characterId) => {
      const character = script.characters.find((item) => item.id === characterId)
      if (!character) return
      const introducedAt = sceneIndex(character.introducedSceneId)
      if (index > 0 && !charactersSeen.has(characterId) && introducedAt >= index) {
        warnings.push({
          id: `character-${scene.id}-${characterId}`,
          type: 'character',
          severity: index > 1 ? 'error' : 'warning',
          sceneId: scene.id,
          title: `${character.name}突然出现`,
          detail: `角色在场景 ${scene.number} 首次出现，但前序场景没有建立其身份、关系或到场铺垫。`,
          suggestion: `在更早场景补充提及、声音或到场动作，并把“首次建立”场景改为相应场次。`
        })
      }
      charactersSeen.add(characterId)
    })

    scene.propIds.forEach((propId) => {
      const prop = script.props.find((item) => item.id === propId)
      if (!prop) return
      const introducedAt = sceneIndex(prop.introducedSceneId)
      if (!propsSeen.has(propId) && introducedAt > index) {
        warnings.push({
          id: `prop-${scene.id}-${propId}`,
          type: 'prop',
          severity: 'error',
          sceneId: scene.id,
          title: `${prop.name}尚未提前建立`,
          detail: `道具在场景 ${scene.number} 已出现，但首次建立被标记在场景 ${script.scenes[introducedAt]?.number ?? '未知'}。`,
          suggestion: '调整首次建立场景，或在当前场景加入来源、交接动作与持有人反应。'
        })
      }
      propsSeen.add(propId)
    })

    Object.entries(scene.costumes).forEach(([characterId, wardrobeId]) => {
      const wardrobe = script.wardrobes.find((item) => item.id === wardrobeId)
      const character = script.characters.find((item) => item.id === characterId)
      if (!wardrobe || !character) return
      if (!wardrobe.timePeriods.includes(scene.dayNight)) {
        warnings.push({
          id: `wardrobe-${scene.id}-${characterId}-${wardrobeId}`,
          type: 'wardrobe',
          severity: 'warning',
          sceneId: scene.id,
          title: `${character.name}服装与时间冲突`,
          detail: `“${wardrobe.name}”只配置用于 ${wardrobe.timePeriods.join('、')}，本场标记为“${scene.dayNight}”。`,
          suggestion: '确认是否跨越时间连续拍摄；如需延续服装，请把当前时段加入服装适用范围。'
        })
      }
    })

    if (index > 0 && script.scenes[index - 1].storyTime && scene.storyTime && index > 0) {
      const previous = script.scenes[index - 1]
      const previousDay = previous.storyTime.match(/第\s*(\d+)\s*天/)?.[1]
      const currentDay = scene.storyTime.match(/第\s*(\d+)\s*天/)?.[1]
      if (previousDay && currentDay && Number(currentDay) < Number(previousDay)) {
        warnings.push({
          id: `timeline-${scene.id}`,
          type: 'timeline',
          severity: 'error',
          sceneId: scene.id,
          title: '时间线出现倒退',
          detail: `上一场为第 ${previousDay} 天，本场却标记为第 ${currentDay} 天，可能造成观看顺序混乱。`,
          suggestion: '调整故事时间，或明确使用倒叙并在场次摘要中标注时间跳转。'
        })
      }
    }
  })
  return warnings
}

export function diffScript(base: Script, current: Script): DiffItem[] {
  const fields: Array<{ key: keyof Scene; label: string }> = [
    { key: 'slug', label: '场名' },
    { key: 'synopsis', label: '摘要' },
    { key: 'intExt', label: '内外景' },
    { key: 'location', label: '地点' },
    { key: 'dayNight', label: '日夜' },
    { key: 'storyTime', label: '故事时间' },
    { key: 'pageLength', label: '页数' },
    { key: 'revision', label: '修订色' },
    { key: 'status', label: '状态' },
    { key: 'reason', label: '修改理由' }
  ]
  const result: DiffItem[] = []
  const sceneKey = (scene: Scene) => `${scene.number}|${scene.slug}`
  const baseByKey = new Map(base.scenes.map((scene) => [sceneKey(scene), scene]))
  current.scenes.forEach((scene) => {
    const previous = baseByKey.get(sceneKey(scene)) ?? base.scenes.find((item) => item.id === scene.id)
    if (!previous) {
      result.push({ id: `new-${scene.id}`, sceneNumber: scene.number, field: '场次', before: '不存在', after: `${scene.intExt}. ${scene.location} — ${scene.dayNight}` })
      return
    }
    fields.forEach(({ key, label }) => {
      const before = String(previous[key] ?? '')
      const after = String(scene[key] ?? '')
      if (before !== after) result.push({ id: `${scene.id}-${String(key)}`, field: label, sceneNumber: scene.number, before, after })
    })
  })
  base.scenes.forEach((scene) => {
    if (!current.scenes.some((item) => item.id === scene.id || sceneKey(item) === sceneKey(scene))) {
      result.push({ id: `deleted-${scene.id}`, sceneNumber: scene.number, field: '场次', before: `${scene.intExt}. ${scene.location} — ${scene.dayNight}`, after: '已删除' })
    }
  })
  return result
}

export interface PublishResult {
  ok: boolean
  error?: string
  applied?: number
}

export type ContinuityStore = ReturnType<typeof useContinuityStore>

export function useContinuityStore() {
  const [state, setState] = useState<ContinuityState>(initialState)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved')
  const undoRef = useRef<Script[]>([])
  const redoRef = useRef<Script[]>([])
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    setSaveStatus('saving')
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      setSaveStatus('saved')
    }, 160)
    return () => window.clearTimeout(saveTimer.current)
  }, [state])

  /* mutate 只服务剧本工作稿；现场包/裁决/现场记录走独立状态，不进剧本撤销栈 */
  const mutate = useCallback((mutator: (script: Script) => void) => {
    setState((previous) => {
      const next = clone(previous.script)
      mutator(next)
      undoRef.current.push(clone(previous.script))
      if (undoRef.current.length > 80) undoRef.current.shift()
      redoRef.current = []
      return { ...previous, script: next, updatedAt: new Date().toISOString() }
    })
  }, [])

  const mutatePackages = useCallback((mutator: (draft: { packages: ShootPackage[]; sceneRecords: Record<string, ShootSceneRecord>; arbitrations: ArbitrationRecord[] }) => void) => {
    setState((previous) => {
      const packages = clone(previous.packages)
      const sceneRecords = clone(previous.sceneRecords)
      const arbitrations = clone(previous.arbitrations)
      mutator({ packages, sceneRecords, arbitrations })
      packages.forEach((pkg) => { pkg.updatedAt = new Date().toISOString() })
      return { ...previous, packages, sceneRecords, arbitrations, updatedAt: new Date().toISOString() }
    })
  }, [])

  const undo = useCallback(() => {
    setState((previous) => {
      const target = undoRef.current.pop()
      if (!target) return previous
      redoRef.current.push(clone(previous.script))
      return { ...previous, script: target, updatedAt: new Date().toISOString() }
    })
  }, [])

  const redo = useCallback(() => {
    setState((previous) => {
      const target = redoRef.current.pop()
      if (!target) return previous
      undoRef.current.push(clone(previous.script))
      return { ...previous, script: target, updatedAt: new Date().toISOString() }
    })
  }, [])

  const updateScriptField = useCallback((field: 'title' | 'writer' | 'draft', value: string) => {
    mutate((script) => { script[field] = value })
  }, [mutate])

  const updateScene = useCallback((sceneId: string, field: keyof Scene, value: Scene[keyof Scene]) => {
    // 锁定只能通过 lockScene（含待裁决门禁）；普通字段编辑在 UI 层对锁定场禁用。
    if (field === 'status' && value === 'locked') return
    mutate((script) => {
      const scene = script.scenes.find((item) => item.id === sceneId)
      if (scene) (scene as unknown as Record<string, unknown>)[field] = value
    })
  }, [mutate])

  const toggleSceneRelation = useCallback((sceneId: string, field: 'characterIds' | 'propIds', itemId: string) => {
    mutate((script) => {
      const scene = script.scenes.find((item) => item.id === sceneId)
      if (!scene) return
      const values = scene[field]
      scene[field] = values.includes(itemId) ? values.filter((value) => value !== itemId) : [...values, itemId]
    })
  }, [mutate])

  const setCostume = useCallback((sceneId: string, characterId: string, wardrobeId: string) => {
    mutate((script) => {
      const scene = script.scenes.find((item) => item.id === sceneId)
      if (!scene) return
      if (!wardrobeId) delete scene.costumes[characterId]
      else scene.costumes[characterId] = wardrobeId
    })
  }, [mutate])

  const moveScene = useCallback((sceneId: string, direction: -1 | 1) => {
    mutate((script) => {
      const index = script.scenes.findIndex((scene) => scene.id === sceneId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= script.scenes.length) return
      const [scene] = script.scenes.splice(index, 1)
      script.scenes.splice(target, 0, scene)
    })
  }, [mutate])

  const addScene = useCallback(() => {
    const sceneId = id('scene')
    mutate((script) => {
      const number = String(script.scenes.length + 1)
      script.scenes.push({
        id: sceneId, number, slug: '未命名场景', synopsis: '', intExt: 'INT', location: '待填写', dayNight: '白天', storyTime: `第 1 天`, pageLength: 1,
        characterIds: [], propIds: [], costumes: {}, revision: 'white', status: 'draft', reason: ''
      })
    })
    return sceneId
  }, [mutate])

  const deleteScene = useCallback((sceneId: string) => {
    if (state.script.scenes.length <= 1) return
    mutate((script) => { script.scenes = script.scenes.filter((scene) => scene.id !== sceneId) })
  }, [mutate, state.script.scenes.length])

  const addCharacter = useCallback(() => {
    mutate((script) => {
      script.characters.push({ id: id('char'), name: '新角色', actor: '待定', introducedSceneId: script.scenes[0]?.id ?? '', note: '' })
    })
  }, [mutate])

  const updateCharacter = useCallback((characterId: string, field: keyof Character, value: string) => {
    mutate((script) => {
      const item = script.characters.find((character) => character.id === characterId)
      if (item) item[field] = value
    })
  }, [mutate])

  const addProp = useCallback(() => {
    mutate((script) => {
      script.props.push({ id: id('prop'), name: '新道具', introducedSceneId: script.scenes[0]?.id ?? '', ownerId: script.characters[0]?.id ?? '', note: '' })
    })
  }, [mutate])

  const updateProp = useCallback((propId: string, field: keyof Prop, value: string) => {
    mutate((script) => {
      const item = script.props.find((prop) => prop.id === propId)
      if (item) item[field] = value
    })
  }, [mutate])

  const addWardrobe = useCallback(() => {
    mutate((script) => {
      script.wardrobes.push({ id: id('ward'), characterId: script.characters[0]?.id ?? '', name: '新服装', timePeriods: ['白天'], note: '' })
    })
  }, [mutate])

  const updateWardrobe = useCallback((wardrobeId: string, field: keyof Wardrobe, value: string | string[]) => {
    mutate((script) => {
      const item = script.wardrobes.find((wardrobe) => wardrobe.id === wardrobeId)
      if (item) {
        if (field === 'timePeriods') item.timePeriods = value as string[]
        else item[field] = value as never
      }
    })
  }, [mutate])

  const setReviewStatus = useCallback((warningId: string, status: WarningReview['status']) => {
    setState((previous) => ({
      ...previous,
      reviews: {
        ...previous.reviews,
        [warningId]: { ...(previous.reviews[warningId] ?? { replies: [] }), status }
      },
      updatedAt: new Date().toISOString()
    }))
  }, [])

  const addReply = useCallback((warningId: string, author: string, text: string) => {
    if (!text.trim()) return
    const reply: Reply = { id: id('reply'), author, text: text.trim(), createdAt: new Date().toISOString() }
    setState((previous) => ({
      ...previous,
      reviews: {
        ...previous.reviews,
        [warningId]: {
          status: previous.reviews[warningId]?.status ?? 'pending',
          replies: [...(previous.reviews[warningId]?.replies ?? []), reply]
        }
      },
      updatedAt: new Date().toISOString()
    }))
  }, [])

  const createVersion = useCallback((name: string) => {
    const version: Version = { id: id('version'), name: name.trim() || `版本 ${state.versions.length + 1}`, createdAt: new Date().toISOString(), script: clone(state.script) }
    setState((previous) => ({ ...previous, versions: [version, ...previous.versions] }))
    return version
  }, [state.script, state.versions.length])

  const restoreVersion = useCallback((versionId: string) => {
    const version = state.versions.find((item) => item.id === versionId)
    if (!version) return
    mutate((script) => { Object.assign(script, clone(version.script)) })
  }, [mutate, state.versions])

  const reset = useCallback(() => {
    mutate((script) => { Object.assign(script, clone(sampleScript)) })
    setState((previous) => ({ ...previous, reviews: {}, packages: [], sceneRecords: {}, arbitrations: [] }))
  }, [mutate])

  /* ============ 现场交接包（独立状态所有权） ============ */

  const createHandoverPackage = useCallback((name: string, shootDay: string) => {
    const pkg = createPackageFromScript(state.script, name, shootDay)
    setState((previous) => ({ ...previous, packages: [pkg, ...previous.packages] }))
    return pkg
  }, [state.script])

  const updatePackageEntry = useCallback((packageId: string, entryId: string, patch: Partial<PackageSceneEntry>) => {
    mutatePackages(({ packages }) => {
      const pkg = packages.find((item) => item.id === packageId)
      const entry = pkg?.entries.find((item) => item.id === entryId)
      if (entry) Object.assign(entry, patch)
    })
  }, [mutatePackages])

  const toggleEntryReference = useCallback((packageId: string, entryId: string, kind: 'character' | 'prop', refId: string, refName: string) => {
    mutatePackages(({ packages }) => {
      const entry = packages.find((item) => item.id === packageId)?.entries.find((item) => item.id === entryId)
      if (!entry) return
      if (kind === 'character') {
        const exists = entry.characterIds.includes(refId)
        entry.characterIds = exists ? entry.characterIds.filter((value) => value !== refId) : [...entry.characterIds, refId]
        entry.characterNames = exists ? entry.characterNames.filter((value) => value !== refName) : [...entry.characterNames.filter((value) => value !== refName), refName]
        if (exists) entry.costumeChanges = entry.costumeChanges.filter((change) => change.characterId !== refId)
      } else {
        const exists = entry.propIds.includes(refId)
        entry.propIds = exists ? entry.propIds.filter((value) => value !== refId) : [...entry.propIds, refId]
        entry.propNames = exists ? entry.propNames.filter((value) => value !== refName) : [...entry.propNames.filter((value) => value !== refName), refName]
      }
    })
  }, [mutatePackages])

  const setEntryCostume = useCallback((packageId: string, entryId: string, characterId: string, wardrobeId: string) => {
    mutatePackages(({ packages }) => {
      const entry = packages.find((item) => item.id === packageId)?.entries.find((item) => item.id === entryId)
      if (!entry) return
      entry.costumeChanges = entry.costumeChanges.filter((change) => change.characterId !== characterId)
      if (wardrobeId) {
        const wardrobe = state.script.wardrobes.find((item) => item.id === wardrobeId)
        const character = state.script.characters.find((item) => item.id === characterId)
        if (wardrobe && character) {
          entry.costumeChanges.push({ characterId, characterName: character.name, wardrobeId, wardrobeName: wardrobe.name, note: '' })
        }
      }
    })
  }, [mutatePackages, state.script.wardrobes, state.script.characters])

  /** 导入：按场次编号 + 修订色归位；不一致/拆分/缺号 → 待裁决区，本地正文原样保留。 */
  const importHandoverPackage = useCallback((raw: string): { imported: number; matched: number; conflicts: number } => {
    const incoming = parsePackageFile(raw)
    let matched = 0
    let conflicts = 0
    setState((previous) => {
      const script = previous.script
      const packages = clone(previous.packages).filter((pkg) => pkg.id !== incoming.id)
      const pkg = clone(incoming)
      // 重新导入视为新一轮交接：清掉发布态，但保留为新尝试
      if (pkg.status === 'published') pkg.status = 'ready'
      pkg.checkpoint = undefined
      pkg.lastError = undefined
      packages.unshift(pkg)

      const keptArbitrations = previous.arbitrations.filter((record) => record.packageId !== pkg.id)
      const freshArbitrations: ArbitrationRecord[] = []
      pkg.entries.forEach((entry) => {
        const result = classifyEntry(entry, script)
        if (result.kind === 'match') {
          matched += 1
          return
        }
        conflicts += 1
        const prior = previous.arbitrations.find(
          (record) => record.packageId === pkg.id && record.entryId === entry.id && record.reason === result.reason
        )
        // 同一条记录、同一原因且已裁决，保留作者/审阅人的裁决结论；否则重新挂起
        if (prior && prior.status !== 'pending') freshArbitrations.push(prior)
        else {
          freshArbitrations.push({
            id: id('arb'),
            packageId: pkg.id,
            entryId: entry.id,
            reason: result.reason,
            detail: result.detail,
            status: 'pending',
            createdAt: new Date().toISOString()
          })
        }
      })

      return {
        ...previous,
        packages,
        arbitrations: [...freshArbitrations, ...keptArbitrations],
        updatedAt: new Date().toISOString()
      }
    })
    return { imported: incoming.entries.length, matched, conflicts }
  }, [])

  const resolveArbitration = useCallback((arbitrationId: string, decision: 'accepted' | 'rejected', sceneId?: string) => {
    mutatePackages(({ arbitrations }) => {
      const record = arbitrations.find((item) => item.id === arbitrationId)
      if (!record) return
      record.status = decision
      record.resolvedAt = new Date().toISOString()
      record.resolutionSceneId = decision === 'accepted' ? sceneId : undefined
    })
  }, [mutatePackages])

  /**
   * 发布：事务式写入现场记录。
   * - 写入前留存检查点（上一包状态 + 受影响场次的旧记录）；
   * - 失败时回滚，已发布的上一包和检查点都保留；
   * - 重试按 packageId+entryId 幂等覆盖，绝不重复追加；
   * - 该包存在未裁决记录时拒绝发布。
   */
  const publishPackage = useCallback((packageId: string, simulateFailure = false): PublishResult => {
    const pkg = state.packages.find((item) => item.id === packageId)
    if (!pkg) return { ok: false, error: '交接包不存在。' }
    const pending = state.arbitrations.filter((record) => record.packageId === packageId && record.status === 'pending')
    if (pending.length) return { ok: false, error: `还有 ${pending.length} 条未裁决记录，归位完成前不能发布。` }

    const targets = new Map<string, Scene>()
    for (const entry of pkg.entries) {
      const record = state.arbitrations.find((item) => item.packageId === packageId && item.entryId === entry.id)
      if (record?.status === 'rejected') continue
      let scene: Scene | undefined
      if (record?.status === 'accepted' && record.resolutionSceneId) {
        scene = state.script.scenes.find((item) => item.id === record.resolutionSceneId)
      } else {
        const result = classifyEntry(entry, state.script)
        if (result.kind === 'match') scene = state.script.scenes.find((item) => item.id === result.sceneId)
      }
      if (!scene) return { ok: false, error: `场次 ${entry.sceneNumber} 仍无明确归位，请先在待裁决区处理。` }
      targets.set(entry.id, scene)
    }

    const targetSceneIds = [...new Set([...targets.values()].map((scene) => scene.id))]
    const recordsBefore: Record<string, ShootSceneRecord> = {}
    targetSceneIds.forEach((sceneId) => {
      if (state.sceneRecords[sceneId]) recordsBefore[sceneId] = clone(state.sceneRecords[sceneId])
    })
    const checkpoint = {
      attemptAt: new Date().toISOString(),
      packageSnapshot: clone(pkg),
      sceneIds: targetSceneIds,
      recordsBefore
    }

    // 模拟断网：检查点留下，状态与现场记录全部保持发布前。
    if (simulateFailure) {
      setState((previous) => ({
        ...previous,
        packages: previous.packages.map((item) => item.id === packageId
          ? { ...item, status: 'failed', lastError: '网络中断：发布未送达，已保留上一包与检查点，可安全重试。', checkpoint }
          : item),
        updatedAt: new Date().toISOString()
      }))
      return { ok: false, error: '网络中断：发布未送达，已保留上一包与检查点，可安全重试。' }
    }

    let sceneRecords = clone(state.sceneRecords)
    const appliedEntries: Array<{ entryId: string; sceneId: string }> = []
    pkg.entries.forEach((entry) => {
      const scene = targets.get(entry.id)
      if (!scene) return
      sceneRecords = applyEntryToRecord(sceneRecords, entry, scene, state.script, packageId)
      appliedEntries.push({ entryId: entry.id, sceneId: scene.id })
    })

    setState((previous) => ({
      ...previous,
      sceneRecords,
      packages: previous.packages.map((item) => {
        if (item.id !== packageId) return item
        const entries = item.entries.map((entry) => {
          const applied = appliedEntries.find((appliedEntry) => appliedEntry.entryId === entry.id)
          return applied ? { ...entry, appliedSceneId: applied.sceneId, appliedAt: new Date().toISOString() } : entry
        })
        return { ...item, entries, status: 'published', publishedAt: new Date().toISOString(), lastError: undefined, checkpoint: undefined }
      }),
      updatedAt: new Date().toISOString()
    }))
    return { ok: true, applied: appliedEntries.length }
  }, [state.packages, state.arbitrations, state.sceneRecords, state.script])

  /** 按检查点回滚失败的发布：恢复受影响场次的旧记录，包回到待发布。 */
  const rollbackPackage = useCallback((packageId: string) => {
    setState((previous) => {
      const pkg = previous.packages.find((item) => item.id === packageId)
      if (!pkg?.checkpoint) return previous
      const snapshot = pkg.checkpoint.packageSnapshot
      const sceneRecords = clone(previous.sceneRecords)
      const checkpoint = pkg.checkpoint
      checkpoint.sceneIds.forEach((sceneId) => {
        const before = checkpoint.recordsBefore[sceneId]
        if (before) sceneRecords[sceneId] = clone(before)
        else delete sceneRecords[sceneId]
      })
      return {
        ...previous,
        sceneRecords,
        packages: previous.packages.map((item) => item.id === packageId
          ? { ...clone(snapshot), status: 'ready', lastError: undefined }
          : item)
      }
    })
  }, [])

  /** 锁定门禁：存在任何未裁决记录时，场次一律不能锁定。 */
  const lockScene = useCallback((sceneId: string): { ok: boolean; pendingCount: number } => {
    const pendingCount = state.arbitrations.filter((record) => record.status === 'pending').length
    if (pendingCount > 0) return { ok: false, pendingCount }
    mutate((script) => {
      const scene = script.scenes.find((item) => item.id === sceneId)
      if (scene) scene.status = 'locked'
    })
    return { ok: true, pendingCount: 0 }
  }, [mutate, state.arbitrations])

  return {
    state,
    saveStatus,
    warnings: deriveWarnings(state.script),
    updateScriptField,
    updateScene,
    toggleSceneRelation,
    setCostume,
    moveScene,
    addScene,
    deleteScene,
    addCharacter,
    updateCharacter,
    addProp,
    updateProp,
    addWardrobe,
    updateWardrobe,
    setReviewStatus,
    addReply,
    createVersion,
    restoreVersion,
    undo,
    redo,
    reset,
    createHandoverPackage,
    updatePackageEntry,
    toggleEntryReference,
    setEntryCostume,
    importHandoverPackage,
    resolveArbitration,
    publishPackage,
    rollbackPackage,
    lockScene
  }
}
