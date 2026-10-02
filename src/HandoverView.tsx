import { useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItemButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import {
  Add,
  CloudUpload,
  Download,
  Gavel,
  History,
  Publish,
  Replay,
  WarningAmber
} from '@mui/icons-material'
import {
  arbitrationReasonLabel,
  classifyEntry,
  packageStatusLabel,
  revisionLabel,
  serializePackage
} from './packageLogic'
import type { ContinuityStore } from './store'
import type { ShootPackage } from './types'

interface HandoverProps {
  store: ContinuityStore
  openScene: (sceneId: string) => void
}

function statusColor(status: ShootPackage['status']): 'default' | 'success' | 'warning' | 'error' | 'info' {
  switch (status) {
    case 'published': return 'success'
    case 'publishing': return 'info'
    case 'failed': return 'error'
    case 'ready': return 'warning'
    default: return 'default'
  }
}

export function HandoverView({ store, openScene }: HandoverProps) {
  const { state } = store
  const [selectedPackageId, setSelectedPackageId] = useState(state.packages[0]?.id ?? '')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [shootDay, setShootDay] = useState('第 1 拍摄日')
  const [feedback, setFeedback] = useState<{ severity: 'success' | 'error' | 'warning' | 'info'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const pkg = state.packages.find((item) => item.id === selectedPackageId) ?? state.packages[0]
  const pendingArbitrations = state.arbitrations.filter((record) => record.status === 'pending')
  const packagePending = (packageId: string) => state.arbitrations.filter((record) => record.packageId === packageId && record.status === 'pending').length

  function createPackage() {
    const created = store.createHandoverPackage(name, shootDay)
    setSelectedPackageId(created.id)
    setName('')
    setCreateOpen(false)
    setFeedback({ severity: 'success', text: `已按当前本地工作稿生成“${created.name}”，只含拍摄事实；正文与修订色仍由本地稿掌握。` })
  }

  function exportPackage(target: ShootPackage) {
    const blob = new Blob([serializePackage(target)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${target.name.replace(/\s+/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function importFile(file: File) {
    try {
      const raw = await file.text()
      const result = store.importHandoverPackage(raw)
      const parsed = JSON.parse(raw) as { package?: { id?: string } }
      if (parsed.package?.id) setSelectedPackageId(parsed.package.id)
      setFeedback({
        severity: result.conflicts ? 'warning' : 'success',
        text: `导入 ${result.imported} 条现场记录：${result.matched} 条按“编号+修订色”自动归位，${result.conflicts} 条进待裁决区，本地正文未被覆盖。`
      })
    } catch (error) {
      setFeedback({ severity: 'error', text: error instanceof Error ? error.message : '导入失败。' })
    }
  }

  function publish(target: ShootPackage, simulateFailure: boolean) {
    const result = store.publishPackage(target.id, simulateFailure)
    if (result.ok) {
      setFeedback({ severity: 'success', text: `发布成功，${result.applied ?? 0} 条现场记录已按场次写入；重试同包不会重复追加。` })
    } else {
      setFeedback({ severity: 'error', text: result.error ?? '发布失败。' })
    }
  }

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} mb={2}>
        <Box>
          <Typography className="eyebrow">SET HANDOVER</Typography>
          <Typography variant="h4">现场交接包</Typography>
          <Typography color="text.secondary">
            两套状态所有权：交接包只记拍摄日、出场角色、道具、服装更换与备注；正文与修订色归本地工作稿。
          </Typography>
        </Box>
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Button variant="contained" startIcon={<Add />} onClick={() => setCreateOpen(true)}>从本地稿建包</Button>
          <Button variant="outlined" startIcon={<CloudUpload />} onClick={() => fileRef.current?.click()}>导入交接包</Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importFile(file)
              event.target.value = ''
            }}
          />
        </Stack>
      </Stack>

      {feedback && <Alert severity={feedback.severity} sx={{ mb: 2 }} onClose={() => setFeedback(null)}>{feedback.text}</Alert>}

      {pendingArbitrations.length > 0 && (
        <Alert severity="warning" icon={<WarningAmber />} sx={{ mb: 2 }}>
          有 {pendingArbitrations.length} 条记录待裁决；未清零前任何场次都不能锁定。
        </Alert>
      )}

      {state.packages.length === 0 ? (
        <Paper className="editor-paper" elevation={0}>
          <Typography color="text.secondary">还没有交接包。拍摄前从当前本地工作稿建一个包，或导入现场回传的包文件。</Typography>
        </Paper>
      ) : (
        <Box className="handover-layout">
          <Paper className="version-list" elevation={0}>
            <Typography variant="h6">交接包</Typography>
            <List disablePadding>
              {state.packages.map((item) => (
                <ListItemButton key={item.id} selected={pkg?.id === item.id} onClick={() => setSelectedPackageId(item.id)}>
                  <Box>
                    <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                      <Typography fontWeight={700}>{item.name}</Typography>
                      <Chip size="small" color={statusColor(item.status)} label={packageStatusLabel(item.status)} />
                      {packagePending(item.id) > 0 && <Chip size="small" color="warning" icon={<Gavel />} label={`${packagePending(item.id)} 待裁`} />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {item.shootDay} · {item.entries.length} 场
                      {item.publishedAt ? ` · 发布于 ${new Date(item.publishedAt).toLocaleString('zh-CN')}` : ''}
                    </Typography>
                  </Box>
                </ListItemButton>
              ))}
            </List>
          </Paper>

          {pkg && (
            <Stack gap={2} className="handover-detail">
              {pkg.status === 'failed' && (
                <Alert
                  severity="error"
                  icon={<WarningAmber />}
                  action={<Button color="inherit" size="small" startIcon={<History />} onClick={() => store.rollbackPackage(pkg.id)}>按检查点回滚</Button>}
                >
                  {pkg.lastError}
                  {pkg.checkpoint ? ` 检查点：${new Date(pkg.checkpoint.attemptAt).toLocaleString('zh-CN')}，上一包与 ${pkg.checkpoint.sceneIds.length} 个场次的旧记录均已保留。` : ''}
                </Alert>
              )}

              <Paper className="editor-paper" elevation={0}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={1}>
                  <Box>
                    <Typography variant="h6">{pkg.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {pkg.shootDay} · 包内修订色仅作归位依据，不会写回正文。
                    </Typography>
                  </Box>
                  <Stack direction="row" gap={1} flexWrap="wrap">
                    <Button size="small" startIcon={<Download />} onClick={() => exportPackage(pkg)}>导出</Button>
                    {pkg.status === 'failed' && (
                      <Tooltip title="断网后的重试按条目幂等覆盖，不重复追加">
                        <Button size="small" variant="contained" color="warning" startIcon={<Replay />} onClick={() => publish(pkg, false)}>重试发布</Button>
                      </Tooltip>
                    )}
                    {pkg.status !== 'published' && pkg.status !== 'failed' && (
                      <>
                        <Button size="small" variant="outlined" color="warning" onClick={() => publish(pkg, true)}>模拟断网发布</Button>
                        <Button size="small" variant="contained" startIcon={<Publish />} onClick={() => publish(pkg, false)}>发布</Button>
                      </>
                    )}
                  </Stack>
                </Stack>
              </Paper>

              <ArbitrationSection packageId={pkg.id} store={store} openScene={openScene} />

              <Stack gap={1.5}>
                {pkg.entries.map((entry) => {
                  const result = classifyEntry(entry, state.script)
                  const matched = result.kind === 'match'
                  const scene = matched ? state.script.scenes.find((item) => item.id === result.sceneId) : undefined
                  const arbitration = state.arbitrations.find((record) => record.packageId === pkg.id && record.entryId === entry.id)
                  const record = state.sceneRecords[entry.appliedSceneId ?? scene?.id ?? '']
                  const readOnly = pkg.status === 'published'
                  return (
                    <Paper key={entry.id} className={`editor-paper package-entry ${!matched && arbitration?.status === 'pending' ? 'has-conflict' : ''}`} elevation={0}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1} flexWrap="wrap">
                        <Box>
                          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                            <Box className="scene-number small">{entry.sceneNumber}</Box>
                            <span className={`revision-dot revision-${entry.revision}`} title={`包内修订色：${revisionLabel(entry.revision)}`} />
                            <Typography variant="body2" color="text.secondary">修订色 {revisionLabel(entry.revision)}</Typography>
                            {matched
                              ? <Chip size="small" color="success" label={`归位：${scene?.slug ?? ''}`} onClick={() => scene && openScene(scene.id)} />
                              : <Chip size="small" color="warning" label={arbitrationReasonLabel(arbitration?.reason ?? 'scene_not_found')} />}
                            {entry.appliedAt && <Chip size="small" variant="outlined" label={`已写入 ${new Date(entry.appliedAt).toLocaleTimeString('zh-CN')}`} />}
                          </Stack>
                        </Box>
                      </Stack>

                      <Box className="package-fields">
                        <TextField
                          size="small"
                          label="拍摄日"
                          value={entry.shootDate}
                          disabled={readOnly}
                          onChange={(event) => store.updatePackageEntry(pkg.id, entry.id, { shootDate: event.target.value })}
                        />
                        <TextField
                          size="small"
                          fullWidth
                          multiline
                          minRows={1}
                          label="现场备注（道具状态、连戏问题等）"
                          value={entry.note}
                          disabled={readOnly}
                          onChange={(event) => store.updatePackageEntry(pkg.id, entry.id, { note: event.target.value })}
                        />
                      </Box>

                      <Box className="package-facts">
                        <Box>
                          <Typography className="section-label">出场角色（现场勾选）</Typography>
                          <Box className="chip-selector">
                            {state.script.characters.map((character) => (
                              <Chip
                                key={character.id}
                                size="small"
                                label={character.name}
                                color={entry.characterIds.includes(character.id) ? 'primary' : 'default'}
                                variant={entry.characterIds.includes(character.id) ? 'filled' : 'outlined'}
                                disabled={readOnly}
                                onClick={() => store.toggleEntryReference(pkg.id, entry.id, 'character', character.id, character.name)}
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
                                disabled={readOnly}
                                onClick={() => store.toggleEntryReference(pkg.id, entry.id, 'prop', prop.id, prop.name)}
                              />
                            ))}
                          </Box>
                        </Box>
                        <Box className="package-costumes">
                          <Typography className="section-label">服装更换</Typography>
                          {entry.characterIds.length === 0
                            ? <Typography variant="caption" color="text.secondary">先勾选出场角色。</Typography>
                            : entry.characterIds.map((characterId) => {
                              const character = state.script.characters.find((item) => item.id === characterId)
                              if (!character) return null
                              const options = state.script.wardrobes.filter((wardrobe) => wardrobe.characterId === characterId)
                              const current = entry.costumeChanges.find((change) => change.characterId === characterId)?.wardrobeId ?? ''
                              return (
                                <TextField
                                  key={characterId}
                                  size="small"
                                  select
                                  label={`${character.name}换装`}
                                  value={current}
                                  disabled={readOnly}
                                  onChange={(event) => store.setEntryCostume(pkg.id, entry.id, characterId, event.target.value)}
                                >
                                  <MenuItem value="">无更换</MenuItem>
                                  {options.map((wardrobe) => <MenuItem key={wardrobe.id} value={wardrobe.id}>{wardrobe.name}</MenuItem>)}
                                </TextField>
                              )
                            })}
                        </Box>
                      </Box>

                      {record && (
                        <Typography variant="caption" color="text.secondary" className="record-hint">
                          本地场次已存有该条现场记录（{record.shootDate}）。正文与修订色始终独立，不在此编辑。
                        </Typography>
                      )}
                    </Paper>
                  )
                })}
              </Stack>
            </Stack>
          )}
        </Box>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>从本地工作稿生成现场交接包</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" mb={2}>
            建包会快照每个场次的编号、修订色、角色、道具与服装，供断网拍摄时在现场编辑；剧本正文不会进入包。
          </Typography>
          <Stack gap={2}>
            <TextField autoFocus fullWidth label="包名称" value={name} placeholder="如：第 1 拍摄日 · 堤岸夜戏" onChange={(event) => setName(event.target.value)} />
            <TextField fullWidth label="拍摄日" value={shootDay} onChange={(event) => setShootDay(event.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>取消</Button>
          <Button variant="contained" onClick={createPackage}>生成</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function ArbitrationSection({ packageId, store, openScene }: { packageId: string; store: ContinuityStore; openScene: (sceneId: string) => void }) {
  const { state } = store
  const records = state.arbitrations.filter((record) => record.packageId === packageId)

  if (records.length === 0) return null

  return (
    <Paper className="editor-paper arbitration-panel" elevation={0}>
      <Stack direction="row" alignItems="center" gap={1} mb={1}>
        <Gavel color="warning" />
        <Typography variant="h6">待裁决区</Typography>
        <Typography variant="body2" color="text.secondary">归位不一致时本地内容原样保留，由作者/场记在此决定。</Typography>
      </Stack>
      <Stack gap={1.5}>
        {records.map((record) => {
          const entry = state.packages.find((pkg) => pkg.id === packageId)?.entries.find((item) => item.id === record.entryId)
          const targetScene = record.resolutionSceneId
            ? state.script.scenes.find((scene) => scene.id === record.resolutionSceneId)
            : undefined
          return (
            <Box key={record.id} className={`arbitration-item status-${record.status}`}>
              <Box>
                <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                  <Chip size="small" color={record.status === 'pending' ? 'warning' : record.status === 'accepted' ? 'success' : 'default'} label={arbitrationReasonLabel(record.reason)} />
                  <Typography fontWeight={700}>包内场次 {entry?.sceneNumber ?? '?'}</Typography>
                  {entry && <span className={`revision-dot revision-${entry.revision}`} />}
                  {record.status !== 'pending' && <Chip size="small" variant="outlined" label={record.status === 'accepted' ? '已采纳归位' : '已拒绝（保留本地）'} />}
                </Stack>
                <Typography variant="body2" mt={0.5}>{record.detail}</Typography>
              </Box>

              {record.status === 'pending' && (
                <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} mt={1.5} alignItems={{ sm: 'center' }}>
                  <TextField
                    select
                    size="small"
                    sx={{ minWidth: 280 }}
                    label="采纳并归位到本地场次"
                    value=""
                    onChange={(event) => store.resolveArbitration(record.id, 'accepted', event.target.value)}
                  >
                    <MenuItem value="" disabled>选择场次…</MenuItem>
                    {state.script.scenes.map((scene) => (
                      <MenuItem key={scene.id} value={scene.id}>场景 {scene.number} · {scene.slug}（{revisionLabel(scene.revision)}）</MenuItem>
                    ))}
                  </TextField>
                  <Button size="small" color="inherit" onClick={() => store.resolveArbitration(record.id, 'rejected')}>
                    拒绝并保留本地内容
                  </Button>
                </Stack>
              )}

              {record.status === 'accepted' && targetScene && (
                <Box mt={1}><Button size="small" onClick={() => openScene(targetScene.id)}>打开归位场次 {targetScene.number}</Button></Box>
              )}
              <Divider sx={{ mt: 1.5 }} />
            </Box>
          )
        })}
      </Stack>
    </Paper>
  )
}
