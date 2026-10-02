import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import {
  Add,
  CheckCircle,
  CloudOff,
  CloudUpload,
  DeleteOutline,
  Download,
  Gavel,
  Inventory2,
  Replay,
  Scale,
  WarningAmber
} from '@mui/icons-material'
import type { ContinuityStore } from './store'
import type { AttachedHandoff, HandoffEntry, Script, WardrobeChange } from './types'
import { isForceFail, setForceFail } from './transport'
import { arbitrationReasonHint, arbitrationReasonLabel } from './handoff'
import { revisionLabel, revisionOptions } from './options'

function FactRows({ record, script }: { record: Pick<AttachedHandoff, 'characterIds' | 'propIds' | 'wardrobeChanges' | 'notes' | 'shootDate'>; script: Script }) {
  const names = (ids: string[], table: Script['characters'] | Script['props']) =>
    ids.map((itemId) => table.find((item) => item.id === itemId)?.name ?? itemId)
  return (
    <Stack gap={0.75} className="fact-rows">
      <span><strong>拍摄日</strong>{record.shootDate || '未填写'}</span>
      {record.characterIds.length > 0 && (
        <span><strong>出场角色</strong>{names(record.characterIds, script.characters).join('、')}</span>
      )}
      {record.propIds.length > 0 && (
        <span><strong>道具</strong>{names(record.propIds, script.props).join('、')}</span>
      )}
      {record.wardrobeChanges.map((change) => (
        <WardrobeChangeLine key={change.id} change={change} script={script} />
      ))}
      {record.notes && <span className="fact-note"><strong>备注</strong>{record.notes}</span>}
    </Stack>
  )
}

function WardrobeChangeLine({ change, script }: { change: WardrobeChange; script: Script }) {
  const character = script.characters.find((item) => item.id === change.characterId)
  const wardrobe = script.wardrobes.find((item) => item.id === change.wardrobeId)
  return (
    <span>
      <strong>服装更换</strong>
      {character?.name ?? change.characterId} → {wardrobe?.name ?? '未指定'}
      {change.note ? `（${change.note}）` : ''}
    </span>
  )
}

export function AttachedHandoffCard({ record, script }: { record: AttachedHandoff; script: Script }) {
  return (
    <Paper className={`attached-card ${record.viaArbitration ? 'via-arb' : ''}`} elevation={0}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
        <Stack direction="row" gap={1} alignItems="center">
          <span className={`revision-swatch revision-${record.revision}`} />
          <Typography fontWeight={700}>{record.packageName}</Typography>
          {record.viaArbitration && <Chip size="small" color="secondary" variant="outlined" label="经裁决挂入" />}
        </Stack>
        <Typography variant="caption" color="text.secondary">{new Date(record.attachedAt).toLocaleString('zh-CN')}</Typography>
      </Stack>
      <FactRows record={record} script={script} />
    </Paper>
  )
}

function DraftEntryEditor({ store, entry }: { store: ContinuityStore; entry: HandoffEntry }) {
  const { state } = store
  return (
    <Paper className="entry-card" elevation={0}>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} alignItems={{ sm: 'center' }}>
        <TextField
          label="场次编号"
          size="small"
          value={entry.sceneNumber}
          sx={{ width: 130 }}
          onChange={(event) => store.updateDraftEntry(entry.id, 'sceneNumber', event.target.value)}
        />
        <TextField
          select
          size="small"
          label="通告单修订色"
          value={entry.revision}
          sx={{ width: 160 }}
          onChange={(event) => store.updateDraftEntry(entry.id, 'revision', event.target.value)}
        >
          {revisionOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}><span className={`revision-swatch revision-${option.value}`} />{option.label}</MenuItem>
          ))}
        </TextField>
        <TextField
          type="date"
          size="small"
          label="拍摄日"
          value={entry.shootDate}
          sx={{ width: 170 }}
          InputLabelProps={{ shrink: true }}
          onChange={(event) => store.updateDraftEntry(entry.id, 'shootDate', event.target.value)}
        />
        <Box flex={1} />
        <Tooltip title="移除该场记录">
          <IconButton color="error" onClick={() => store.removeDraftEntry(entry.id)}><DeleteOutline /></IconButton>
        </Tooltip>
      </Stack>

      <Box className="entry-refs">
        <Box>
          <Typography className="section-label">出场角色</Typography>
          <Box className="chip-selector">
            {state.script.characters.map((character) => (
              <Chip
                key={character.id}
                size="small"
                label={character.name}
                color={entry.characterIds.includes(character.id) ? 'primary' : 'default'}
                variant={entry.characterIds.includes(character.id) ? 'filled' : 'outlined'}
                onClick={() => store.toggleDraftEntryRef(entry.id, 'characterIds', character.id)}
              />
            ))}
          </Box>
        </Box>
        <Box>
          <Typography className="section-label">道具</Typography>
          <Box className="chip-selector">
            {state.script.props.map((prop) => (
              <Chip
                key={prop.id}
                size="small"
                label={prop.name}
                color={entry.propIds.includes(prop.id) ? 'secondary' : 'default'}
                variant={entry.propIds.includes(prop.id) ? 'filled' : 'outlined'}
                onClick={() => store.toggleDraftEntryRef(entry.id, 'propIds', prop.id)}
              />
            ))}
          </Box>
        </Box>
      </Box>

      <Box className="entry-wardrobe">
        <Typography className="section-label">服装更换</Typography>
        <Stack gap={1}>
          {entry.wardrobeChanges.map((change) => (
            <Stack key={change.id} direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }}>
              <Chip size="small" label={state.script.characters.find((item) => item.id === change.characterId)?.name ?? '角色'} />
              <TextField select size="small" label="换上服装" value={change.wardrobeId} sx={{ minWidth: 200 }}
                onChange={(event) => store.updateDraftWardrobeChange(entry.id, change.id, 'wardrobeId', event.target.value)}>
                <MenuItem value="">未指定</MenuItem>
                {state.script.wardrobes.filter((item) => item.characterId === change.characterId).map((item) => (
                  <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>
                ))}
              </TextField>
              <TextField size="small" label="现场说明" fullWidth value={change.note}
                onChange={(event) => store.updateDraftWardrobeChange(entry.id, change.id, 'note', event.target.value)} />
              <IconButton size="small" color="error" onClick={() => store.removeDraftWardrobeChange(entry.id, change.id)}><DeleteOutline fontSize="small" /></IconButton>
            </Stack>
          ))}
          <Stack direction="row" gap={1} flexWrap="wrap">
            {state.script.characters
              .filter((character) => !entry.wardrobeChanges.some((change) => change.characterId === character.id))
              .map((character) => (
                <Button key={character.id} size="small" startIcon={<Add fontSize="small" />} onClick={() => store.addDraftWardrobeChange(entry.id, character.id)}>
                  {character.name}换装
                </Button>
              ))}
          </Stack>
        </Stack>
      </Box>

      <TextField
        fullWidth
        size="small"
        multiline
        minRows={1}
        maxRows={4}
        sx={{ mt: 1.2 }}
        placeholder="现场备注（道具状态、临时调整、天气等，只记录事实）"
        value={entry.notes}
        onChange={(event) => store.updateDraftEntry(entry.id, 'notes', event.target.value)}
      />
    </Paper>
  )
}

function PublishPanel({ store }: { store: ContinuityStore }) {
  const { handoff } = store.state
  const { publish } = handoff
  const [forceFail, setForceFailUi] = useState(isForceFail())
  const publishing = publish.phase === 'publishing'

  return (
    <Paper className="publish-panel" elevation={0}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2} alignItems={{ md: 'center' }}>
        <Box>
          <Typography variant="h6">断网拍摄 → 回连发布</Typography>
          <Typography variant="body2" color="text.secondary">
            发布时冻结当前草稿为不可变包。失败会保留上一包与检查点，重试沿用同一 requestHash，不会重复追加。
          </Typography>
        </Box>
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
          <FormControlLabel
            control={<Switch size="small" checked={forceFail} onChange={(event) => { setForceFail(event.target.checked); setForceFailUi(event.target.checked) }} />}
            label={<Typography variant="caption">模拟链路失败</Typography>}
          />
          {publish.phase === 'failed' && (
            <Button variant="contained" color="warning" startIcon={<Replay />} disabled={publishing} onClick={() => store.publishHandoff(false)}>
              重试发布（检查点 #{publish.attempt}）
            </Button>
          )}
          {publish.phase !== 'failed' && (
            <Button variant="contained" startIcon={<CloudUpload />} disabled={publishing} onClick={() => store.publishHandoff(false)}>
              {publishing ? '发布中…' : publish.phase === 'success' ? '发布新草稿包' : '组包并发布'}
            </Button>
          )}
          {publish.phase === 'success' && (
            <Button variant="outlined" startIcon={<Replay />} disabled={publishing} onClick={() => store.publishHandoff(true)}>
              重发上一包（验证幂等）
            </Button>
          )}
        </Stack>
      </Stack>

      {publish.phase === 'failed' && (
        <Alert severity="error" icon={<CloudOff />} sx={{ mt: 1.5 }} action={
          <Button color="inherit" size="small" onClick={() => store.publishHandoff(false)}>立即重试</Button>
        }>
          {publish.reason}
          <br />
          <small>检查点 {publish.checkpointId} 已留存；上一包「{handoff.lastPublishedPackage?.name ?? '无'}」保留未动。草稿编辑不影响待重试的冻结包。</small>
        </Alert>
      )}
      {publish.phase === 'success' && (
        <Alert severity={publish.duplicate ? 'info' : 'success'} icon={<CheckCircle />} sx={{ mt: 1.5 }}>
          {publish.duplicate ? '服务端识别出 requestHash 相同，返回已有回执，未重复追加。' : '交接包已送达并追加到收件箱。'}
          <br /><small>{handoff.lastPublishedPackage?.name} · {publish.requestHash} · {new Date(publish.at).toLocaleString('zh-CN')}</small>
        </Alert>
      )}

      <Box className="checkpoint-strip">
        <Typography className="section-label">检查点</Typography>
        {handoff.checkpoints.length === 0 && <Typography variant="caption" color="text.secondary">尚无检查点。</Typography>}
        <Stack gap={0.5}>
          {handoff.checkpoints.map((cp) => (
            <Stack key={cp.id} direction="row" gap={1} alignItems="center" flexWrap="wrap" className="checkpoint-row">
              <Chip size="small" color={cp.resolvedAt ? 'success' : 'warning'} variant="outlined"
                label={cp.resolvedAt ? '已关闭' : `待重试 · 第 ${cp.attempt} 次`} />
              <span>{cp.packageName}</span>
              <code>{cp.requestHash}</code>
              <small>{new Date(cp.failedAt).toLocaleString('zh-CN')}{cp.resolvedAt ? ` · 关闭于 ${new Date(cp.resolvedAt).toLocaleString('zh-CN')}` : ''}</small>
            </Stack>
          ))}
        </Stack>
      </Box>

      <Divider sx={{ my: 1.5 }} />
      <Box className="publish-log">
        <Typography className="section-label">发布日志</Typography>
        {handoff.log.length === 0 && <Typography variant="caption" color="text.secondary">暂无发布记录。</Typography>}
        {handoff.log.slice(0, 6).map((entry) => (
          <Stack key={entry.id} direction="row" gap={1} alignItems="center" flexWrap="wrap" className="log-row">
            <Chip size="small" color={entry.status === 'success' ? 'success' : 'error'}
              label={entry.status === 'success' ? (entry.duplicate ? '幂等命中' : '成功') : '失败'} />
            <span>{entry.packageName}</span>
            <small>{entry.detail}</small>
            <small>{new Date(entry.at).toLocaleString('zh-CN')}</small>
          </Stack>
        ))}
      </Box>
    </Paper>
  )
}

function ArbitrationQueue({ store, onOpenScene }: { store: ContinuityStore; onOpenScene: (sceneId: string) => void }) {
  const { arbitration } = store.state.handoff
  const [showResolved, setShowResolved] = useState(false)
  const pending = arbitration.filter((item) => item.status === 'pending')
  const resolved = arbitration.filter((item) => item.status !== 'pending')

  return (
    <Paper className="arbitration-panel" elevation={0}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h6"><Gavel sx={{ verticalAlign: -4, mr: 0.5 }} />待裁决区</Typography>
          <Typography variant="body2" color="text.secondary">
            场号或修订色对不上、或指向已拆分场次的现场记录在这里留档；本地正文与修订色原样保留。有未裁决记录时场次不能锁定。
          </Typography>
        </Box>
        <Chip color={pending.length ? 'warning' : 'success'} label={pending.length ? `${pending.length} 条未裁决` : '已全部裁决'} />
      </Stack>

      <Stack gap={1.5} mt={2}>
        {pending.map((item) => (
          <Paper key={item.id} className="arb-card" elevation={0}>
            <Stack direction="row" justifyContent="space-between" gap={1} flexWrap="wrap">
              <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                <Chip size="small" color="warning" icon={<WarningAmber />} label={arbitrationReasonLabel[item.reason]} />
                <strong>现场场号 {item.sceneNumber || '（空）'}</strong>
                <span className={`revision-swatch revision-${item.revision}`} />
                <small>现场：{revisionLabel(item.revision)}{item.localRevision ? ` · 本地：${revisionLabel(item.localRevision)}` : ''}</small>
              </Stack>
              <small>{item.packageName}</small>
            </Stack>
            <Typography variant="body2" color="text.secondary" mt={0.5}>{arbitrationReasonHint[item.reason]}</Typography>
            <Box mt={1}>
              <FactRows record={item} script={store.state.script} />
            </Box>
            <Stack direction="row" gap={1} mt={1.5} flexWrap="wrap" alignItems="center">
              <TextField
                select
                size="small"
                label="手动挂到本地场次"
                defaultValue=""
                sx={{ minWidth: 260 }}
                onChange={(event) => {
                  if (event.target.value) store.resolveArbitration(item.id, { kind: 'attach', sceneId: event.target.value })
                }}
              >
                <MenuItem value="" disabled>选择场次…</MenuItem>
                {store.state.script.scenes.map((scene) => (
                  <MenuItem key={scene.id} value={scene.id}>
                    {scene.number}. {scene.slug}（{revisionLabel(scene.revision)}）{item.candidateSceneIds.includes(scene.id) ? ' · 候选' : ''}
                  </MenuItem>
                ))}
              </TextField>
              {item.candidateSceneIds.map((sceneId) => {
                const scene = store.state.script.scenes.find((s) => s.id === sceneId)
                if (!scene) return null
                return (
                  <Button key={sceneId} size="small" variant="outlined" onClick={() => onOpenScene(sceneId)}>
                    打开候选 {scene.number}. {scene.slug}
                  </Button>
                )
              })}
              <Box flex={1} />
              <Button size="small" color="inherit" onClick={() => store.resolveArbitration(item.id, { kind: 'discard' })}>
                不采用此记录
              </Button>
            </Stack>
          </Paper>
        ))}
        {pending.length === 0 && <Alert severity="success" icon={<Scale />}>没有未裁决记录，场次可以正常锁定。</Alert>}
      </Stack>

      {resolved.length > 0 && (
        <>
          <Button size="small" sx={{ mt: 2 }} onClick={() => setShowResolved((value) => !value)}>
            {showResolved ? '隐藏' : '查看'}已处理记录（{resolved.length}）
          </Button>
          <Collapse in={showResolved}>
            <Stack gap={1} mt={1}>
              {resolved.map((item) => {
                const scene = item.resolvedSceneId ? store.state.script.scenes.find((s) => s.id === item.resolvedSceneId) : null
                return (
                  <Stack key={item.id} direction="row" gap={1} alignItems="center" flexWrap="wrap" className="resolved-row">
                    <Chip size="small" variant="outlined" color={item.status === 'attached' ? 'success' : 'default'}
                      label={item.status === 'attached' ? '已挂入' : '已不采用'} />
                    <span>现场场号 {item.sceneNumber}</span>
                    {scene && <Button size="small" onClick={() => onOpenScene(scene.id)}>→ {scene.number}. {scene.slug}</Button>}
                    <small>{new Date(item.resolvedAt ?? '').toLocaleString('zh-CN')}</small>
                  </Stack>
                )
              })}
            </Stack>
          </Collapse>
        </>
      )}
    </Paper>
  )
}

export default function HandoffView({ store, onOpenScene }: { store: ContinuityStore; onOpenScene: (sceneId: string) => void }) {
  const { handoff } = store.state
  const [importNote, setImportNote] = useState<{ kind: 'success' | 'info'; text: string } | null>(null)
  const canImport = handoff.lastPublishedPackage !== null || handoff.packages.length > 0

  function handleImport() {
    const summary = store.importLastPackage()
    if (summary.attached === 0 && summary.conflicts === 0) {
      setImportNote({ kind: 'info', text: '该包所有条目此前已导入，未重复追加。' })
    } else {
      setImportNote({
        kind: 'success',
        text: `导入完成：${summary.attached} 条按场号+修订色自动归位，${summary.conflicts} 条进入待裁决区${summary.skipped ? `，${summary.skipped} 条已存在而跳过` : ''}。本地正文与修订色未被修改。`
      })
    }
  }

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} mb={2}>
        <Box>
          <Typography className="eyebrow">ON-SET HANDOFF</Typography>
          <Typography variant="h4">现场交接包</Typography>
          <Typography color="text.secondary">
            两套所有权：本页只记录拍摄日、出场角色、道具、服装更换与备注；剧本正文与修订色归本地稿掌握。
          </Typography>
        </Box>
        <Stack direction="row" gap={1}>
          <Button startIcon={<Add />} variant="outlined" onClick={store.addDraftEntry}>新增场次记录</Button>
          <Button startIcon={<Download />} variant="contained" disabled={!canImport} onClick={handleImport}>导入上一包</Button>
        </Stack>
      </Stack>

      <Alert severity="info" icon={<Inventory2 />} sx={{ mb: 2 }}>
        断网期间在此维护现场事实，不触碰剧本正文。回连后组包发布；再点“导入上一包”按场次编号与修订色归位，对不上的进待裁决区。
      </Alert>

      {importNote && <Alert severity={importNote.kind} sx={{ mb: 2 }} onClose={() => setImportNote(null)}>{importNote.text}</Alert>}

      <Paper className="draft-meta" elevation={0}>
        <TextField label="交接包名称" value={handoff.draft.name} onChange={(event) => store.updateDraftMeta('name', event.target.value)} sx={{ minWidth: 280 }} />
        <TextField type="datetime-local" label="备包时间" value={handoff.draft.preparedAt.slice(0, 16)} InputLabelProps={{ shrink: true }}
          onChange={(event) => store.updateDraftMeta('preparedAt', new Date(event.target.value).toISOString())} />
      </Paper>

      <Stack gap={1.5} mb={2}>
        {handoff.draft.entries.map((entry) => <DraftEntryEditor key={entry.id} store={store} entry={entry} />)}
        {handoff.draft.entries.length === 0 && <Alert severity="info">草稿还没有场次记录，点“新增场次记录”开始。</Alert>}
      </Stack>

      <PublishPanel store={store} />
      <Box mt={2}><ArbitrationQueue store={store} onOpenScene={onOpenScene} /></Box>
    </Box>
  )
}
