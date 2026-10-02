import { useCallback, useEffect, useRef, useState } from 'react'
import { sampleScript } from './sample'
import { packageRequestHash, planImport } from './handoff'
import { publishPackage } from './transport'
import type {
  ArbitrationRecord,
  AttachedHandoff,
  Character,
  ContinuityState,
  DiffItem,
  HandoffEntry,
  HandoffPackage,
  HandoffState,
  Prop,
  Reply,
  Scene,
  Script,
  Version,
  Wardrobe,
  WardrobeChange,
  WarningItem,
  WarningReview
} from './types'

const STORAGE_KEY = 'sologsb-1017-continuity-v2'
const LEGACY_KEY = 'sologsb-1017-continuity-v1'
const clone = <T,>(value: T): T => structuredClone(value)
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/* ---------------- 现场交接包种子（与本地剧本稿所有权分离） ---------------- */

function change(characterId: string, wardrobeId: string, note = ''): WardrobeChange {
  return { id: id('wc'), characterId, wardrobeId, note }
}

function defaultHandoff(): HandoffState {
  const draft: HandoffPackage = {
    id: 'pkg-draft',
    name: '现场交接包 · 拍摄日 D1',
    preparedAt: '2026-10-01T07:30:00.000Z',
    entries: [
      {
        id: 'entry-d1',
        sceneNumber: '1',
        revision: 'white',
        shootDate: '2026-10-01',
        characterIds: ['char-lin', 'char-su'],
        propIds: ['prop-recorder'],
        wardrobeChanges: [change('char-lin', 'ward-lin-jacket', '雨大，夹克外补穿黑色雨衣')],
        notes: '苏遥录音包改用左肩，现场雨势比剧本预期大。'
      },
      {
        id: 'entry-d2',
        sceneNumber: '3',
        revision: 'blue', // 本地第 3 场是粉色：导入进待裁决，保留本地修订色
        shootDate: '2026-10-01',
        characterIds: ['char-lin', 'char-su'],
        propIds: ['prop-ticket', 'prop-recorder'],
        wardrobeChanges: [],
        notes: '现场持蓝色通告单拍摄，与作者稿粉色页不一致，待作者确认。'
      },
      {
        id: 'entry-d4a',
        sceneNumber: '5', // 本地无第 5 场：待裁决
        revision: 'green',
        shootDate: '2026-10-01',
        characterIds: ['char-qiao'],
        propIds: ['prop-key'],
        wardrobeChanges: [change('char-qiao', 'ward-qiao-raincoat', '雨衣内侧加毛巾，防穿帮')],
        notes: '补拍灯塔交接，通告标注为拆分后的 5A。'
      }
    ]
  }
  return {
    draft,
    packages: [],
    lastPublishedPackage: null,
    publish: { phase: 'idle' },
    log: [],
    checkpoints: [],
    attached: {},
    arbitration: [],
    importedEntryIds: []
  }
}

function migrateState(parsed: Partial<ContinuityState> & { script?: Script }): ContinuityState | null {
  if (!parsed.script?.scenes?.length) return null
  return {
    script: parsed.script,
    reviews: parsed.reviews ?? {},
    versions: parsed.versions ?? [],
    handoff: parsed.handoff ? { ...defaultHandoff(), ...parsed.handoff } : defaultHandoff(),
    updatedAt: parsed.updatedAt ?? new Date().toISOString()
  }
}

function initialState(): ContinuityState {
  for (const key of [STORAGE_KEY, LEGACY_KEY]) {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const migrated = migrateState(JSON.parse(raw) as Partial<ContinuityState>)
        if (migrated) return migrated
      }
    } catch {
      // Ignore an invalid local draft and keep looking / restore the bundled example.
    }
  }
  return { script: clone(sampleScript), reviews: {}, versions: [], handoff: defaultHandoff(), updatedAt: new Date().toISOString() }
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
      if (before !== after) result.push({ id: `${scene.id}-${String(key)}`, sceneNumber: scene.number, field: label, before, after })
    })
  })
  base.scenes.forEach((scene) => {
    if (!current.scenes.some((item) => item.id === scene.id || sceneKey(item) === sceneKey(scene))) {
      result.push({ id: `deleted-${scene.id}`, sceneNumber: scene.number, field: '场次', before: `${scene.intExt}. ${scene.location} — ${scene.dayNight}`, after: '已删除' })
    }
  })
  return result
}

export interface ImportSummary {
  attached: number
  conflicts: number
  skipped: number
}

export function useContinuityStore() {
  const [state, setState] = useState<ContinuityState>(initialState)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved')
  const undoRef = useRef<Script[]>([])
  const redoRef = useRef<Script[]>([])
  const saveTimer = useRef<number | undefined>(undefined)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    setSaveStatus('saving')
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      setSaveStatus('saved')
    }, 160)
    return () => window.clearTimeout(saveTimer.current)
  }, [state])

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

  const mutateHandoff = useCallback((mutator: (handoff: HandoffState) => void) => {
    setState((previous) => {
      const next = clone(previous.handoff)
      mutator(next)
      return { ...previous, handoff: next, updatedAt: new Date().toISOString() }
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
    mutate((script) => {
      const scene = script.scenes.find((item) => item.id === sceneId)
      if (scene) (scene as unknown as Record<string, unknown>)[field] = value
    })
  }, [mutate])

  /* 锁定闸门：存在未裁决记录时，任何场次都不能锁定。 */
  const setSceneStatus = useCallback((sceneId: string, status: Scene['status']): boolean => {
    const pending = stateRef.current.handoff.arbitration.filter((item) => item.status === 'pending')
    if (status === 'locked' && pending.length > 0) return false
    updateScene(sceneId, 'status', status)
    return true
  }, [updateScene])

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
    setState((previous) => ({ ...previous, reviews: {}, handoff: defaultHandoff() }))
  }, [mutate])

  /* ---------------- 现场交接包：草稿编辑（现场侧所有权） ---------------- */

  const updateDraftMeta = useCallback((field: 'name' | 'preparedAt', value: string) => {
    mutateHandoff((handoff) => { handoff.draft[field] = value })
  }, [mutateHandoff])

  const addDraftEntry = useCallback(() => {
    mutateHandoff((handoff) => {
      handoff.draft.entries.push({
        id: id('entry'), sceneNumber: '', revision: 'white', shootDate: new Date().toISOString().slice(0, 10),
        characterIds: [], propIds: [], wardrobeChanges: [], notes: ''
      })
    })
  }, [mutateHandoff])

  const removeDraftEntry = useCallback((entryId: string) => {
    mutateHandoff((handoff) => {
      handoff.draft.entries = handoff.draft.entries.filter((entry) => entry.id !== entryId)
    })
  }, [mutateHandoff])

  const updateDraftEntry = useCallback((entryId: string, field: keyof Pick<HandoffEntry, 'sceneNumber' | 'revision' | 'shootDate' | 'notes'>, value: string) => {
    mutateHandoff((handoff) => {
      const entry = handoff.draft.entries.find((item) => item.id === entryId)
      if (entry) (entry as unknown as Record<string, string>)[field] = value
    })
  }, [mutateHandoff])

  const toggleDraftEntryRef = useCallback((entryId: string, field: 'characterIds' | 'propIds', itemId: string) => {
    mutateHandoff((handoff) => {
      const entry = handoff.draft.entries.find((item) => item.id === entryId)
      if (!entry) return
      const values = entry[field]
      entry[field] = values.includes(itemId) ? values.filter((value) => value !== itemId) : [...values, itemId]
    })
  }, [mutateHandoff])

  const addDraftWardrobeChange = useCallback((entryId: string, characterId: string) => {
    if (!characterId) return
    mutateHandoff((handoff) => {
      const entry = handoff.draft.entries.find((item) => item.id === entryId)
      const wardrobe = stateRef.current.script.wardrobes.find((item) => item.characterId === characterId)
      if (entry && !entry.wardrobeChanges.some((change) => change.characterId === characterId)) {
        entry.wardrobeChanges.push({ id: id('wc'), characterId, wardrobeId: wardrobe?.id ?? '', note: '' })
      }
    })
  }, [mutateHandoff])

  const updateDraftWardrobeChange = useCallback((entryId: string, changeId: string, field: keyof WardrobeChange, value: string) => {
    mutateHandoff((handoff) => {
      const entry = handoff.draft.entries.find((item) => item.id === entryId)
      const changeItem = entry?.wardrobeChanges.find((item) => item.id === changeId)
      if (changeItem) (changeItem as unknown as Record<string, string>)[field] = value
    })
  }, [mutateHandoff])

  const removeDraftWardrobeChange = useCallback((entryId: string, changeId: string) => {
    mutateHandoff((handoff) => {
      const entry = handoff.draft.entries.find((item) => item.id === entryId)
      if (entry) entry.wardrobeChanges = entry.wardrobeChanges.filter((item) => item.id !== changeId)
    })
  }, [mutateHandoff])

  /* ---------------- 发布：检查点 + 上一包留存 + 幂等重试 ---------------- */

  const publishHandoff = useCallback(async (useLastPackage = false): Promise<void> => {
    const current = stateRef.current.handoff
    if (current.publish.phase === 'publishing') return

    // 失败重试沿用冻结的包快照；成功后“重发上一包”用于验证幂等；否则冻结当前草稿为新包。
    let pkg: HandoffPackage
    let attempt: number
    if (current.publish.phase === 'failed' && current.packages[0]?.id === current.publish.packageId) {
      pkg = current.packages[0]
      attempt = current.publish.attempt // 失败状态里已存的是下一次尝试序号
    } else if (useLastPackage && current.lastPublishedPackage) {
      pkg = current.lastPublishedPackage
      attempt = current.publish.phase === 'success' ? current.publish.attempt : 1
    } else {
      pkg = {
        ...clone(current.draft),
        id: id('pkg'),
        name: current.draft.name.trim() || '未命名交接包',
        preparedAt: new Date().toISOString()
      }
      attempt = 1
    }

    const requestHash = packageRequestHash(pkg)
    setState((previous) => ({
      ...previous,
      handoff: { ...previous.handoff, publish: { phase: 'publishing', packageId: pkg.id, requestHash, attempt, startedAt: new Date().toISOString() } }
    }))

    try {
      const receipt = await publishPackage({ requestHash, packageName: pkg.name, attempt })
      const logEntry = {
        id: id('log'), requestHash, packageId: pkg.id, packageName: pkg.name, attempt,
        status: 'success' as const, duplicate: receipt.duplicate,
        detail: receipt.duplicate ? '服务端识别为同一包，未重复追加（幂等）' : '交接包已送达',
        at: receipt.at
      }
      setState((previous) => ({
        ...previous,
        handoff: {
          ...previous.handoff,
          packages: previous.handoff.packages.some((item) => item.id === pkg.id) ? previous.handoff.packages : [pkg, ...previous.handoff.packages],
          lastPublishedPackage: pkg,
          publish: { phase: 'success', packageId: pkg.id, requestHash, attempt, duplicate: receipt.duplicate, at: receipt.at },
          log: [logEntry, ...previous.handoff.log],
          // 成功送达后关闭该包对应的失败检查点。
          checkpoints: previous.handoff.checkpoints.map((cp) => cp.requestHash === requestHash ? { ...cp, resolvedAt: receipt.at } : cp)
        }
      }))
    } catch (error) {
      const failedAt = new Date().toISOString()
      const reason = error instanceof Error ? error.message : '未知发布失败'
      const nextAttempt = attempt + 1
      const checkpointId = id('cp')
      const logEntry = {
        id: id('log'), requestHash, packageId: pkg.id, packageName: pkg.name, attempt,
        status: 'failed' as const, duplicate: false, detail: reason, at: failedAt
      }
      setState((previous) => {
        // 失败：冻结留存本包（不覆盖上一包之外的内容），并留下检查点；重试不产生新包。
        const packages = previous.handoff.packages.some((item) => item.id === pkg.id) ? previous.handoff.packages : [pkg, ...previous.handoff.packages]
        return {
          ...previous,
          handoff: {
            ...previous.handoff,
            packages,
            lastPublishedPackage: previous.handoff.lastPublishedPackage ?? pkg,
            publish: { phase: 'failed', packageId: pkg.id, requestHash, attempt: nextAttempt, checkpointId, reason, failedAt },
            log: [logEntry, ...previous.handoff.log],
            checkpoints: [
              { id: checkpointId, packageId: pkg.id, packageName: pkg.name, requestHash, attempt, failedAt, reason },
              ...previous.handoff.checkpoints
            ]
          }
        }
      })
    }
  }, [])

  /* ---------------- 导入：按场号+修订色归位，冲突进待裁决，绝不改正文 ---------------- */

  const importLastPackage = useCallback((): ImportSummary => {
    const handoff = stateRef.current.handoff
    const source = handoff.lastPublishedPackage ?? handoff.packages[0]
    if (!source) return { attached: 0, conflicts: 0, skipped: 0 }
    const plan = planImport(source, stateRef.current.script, handoff.importedEntryIds)

    const attached: Array<{ record: AttachedHandoff; sceneId: string }> = []
    const conflicts: ArbitrationRecord[] = []
    const imported: string[] = []
    let skipped = 0
    const now = new Date().toISOString()

    source.entries.forEach((entry, index) => {
      const item = plan.items[index]
      if (item.kind === 'skip') { skipped += 1; return }
      if (item.kind === 'conflict') {
        conflicts.push({
          id: id('arb'),
          packageId: source.id,
          packageName: source.name,
          entryId: entry.id,
          sceneNumber: entry.sceneNumber,
          revision: entry.revision,
          shootDate: entry.shootDate,
          characterIds: [...entry.characterIds],
          propIds: [...entry.propIds],
          wardrobeChanges: clone(entry.wardrobeChanges),
          notes: entry.notes,
          reason: item.reason,
          candidateSceneIds: item.candidateSceneIds,
          localRevision: item.localRevision,
          createdAt: now,
          status: 'pending'
        })
        return
      }
      attached.push({
        sceneId: item.sceneId,
        record: {
          id: id('att'),
          packageId: source.id,
          packageName: source.name,
          entryId: entry.id,
          shootDate: entry.shootDate,
          revision: entry.revision,
          characterIds: [...entry.characterIds],
          propIds: [...entry.propIds],
          wardrobeChanges: clone(entry.wardrobeChanges),
          notes: entry.notes,
          attachedAt: now,
          viaArbitration: false
        }
      })
      imported.push(entry.id)
    })

    mutateHandoff((next) => {
      attached.forEach(({ record, sceneId }) => {
        const list = next.attached[sceneId] ?? []
        if (!list.some((item) => item.entryId === record.entryId)) list.push(record)
        next.attached[sceneId] = list
      })
      conflicts.forEach((record) => {
        if (!next.arbitration.some((item) => item.entryId === record.entryId && item.status === 'pending')) {
          next.arbitration.unshift(record)
        }
      })
      imported.forEach((entryId) => { if (!next.importedEntryIds.includes(entryId)) next.importedEntryIds.push(entryId) })
    })

    return { attached: attached.length, conflicts: conflicts.length, skipped }
  }, [mutateHandoff])

  const resolveArbitration = useCallback((recordId: string, action: { kind: 'discard' } | { kind: 'attach'; sceneId: string }): boolean => {
    const record = stateRef.current.handoff.arbitration.find((item) => item.id === recordId)
    if (!record || record.status !== 'pending') return false
    const now = new Date().toISOString()
    if (action.kind === 'discard') {
      mutateHandoff((next) => {
        const target = next.arbitration.find((item) => item.id === recordId)
        if (target) { target.status = 'discarded'; target.resolvedAt = now }
      })
      return true
    }
    const scene = stateRef.current.script.scenes.find((item) => item.id === action.sceneId)
    if (!scene) return false
    const attached: AttachedHandoff = {
      id: id('att'),
      packageId: record.packageId,
      packageName: record.packageName,
      entryId: record.entryId,
      shootDate: record.shootDate,
      revision: record.revision,
      characterIds: [...record.characterIds],
      propIds: [...record.propIds],
      wardrobeChanges: clone(record.wardrobeChanges),
      notes: record.notes,
      attachedAt: now,
      viaArbitration: true
    }
    mutateHandoff((next) => {
      const list = next.attached[action.sceneId] ?? []
      if (!list.some((item) => item.entryId === attached.entryId)) list.push(attached)
      next.attached[action.sceneId] = list
      if (!next.importedEntryIds.includes(record.entryId)) next.importedEntryIds.push(record.entryId)
      const target = next.arbitration.find((item) => item.id === recordId)
      if (target) { target.status = 'attached'; target.resolvedSceneId = action.sceneId; target.resolvedAt = now }
    })
    return true
  }, [mutateHandoff])

  return {
    state,
    saveStatus,
    warnings: deriveWarnings(state.script),
    updateScriptField,
    updateScene,
    setSceneStatus,
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
    updateDraftMeta,
    addDraftEntry,
    removeDraftEntry,
    updateDraftEntry,
    toggleDraftEntryRef,
    addDraftWardrobeChange,
    updateDraftWardrobeChange,
    removeDraftWardrobeChange,
    publishHandoff,
    importLastPackage,
    resolveArbitration
  }
}

export type ContinuityStore = ReturnType<typeof useContinuityStore>
