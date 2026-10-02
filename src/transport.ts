/* 模拟断网现场 -> 回连后发布交接包的传输层。
 * 服务端收件箱按 requestHash 幂等：同一包重试不会被重复追加。
 * forceFail 模拟本次链路失败；发布失败后应保留上一包与检查点，由调用方重试。 */

const INBOX_KEY = 'sologsb-1017-handoff-inbox-v1'
const FORCE_FAIL_KEY = 'sologsb-1017-handoff-forcefail-v1'

export interface PublishedReceipt {
  requestHash: string
  duplicate: boolean
  at: string
}

function readInbox(): Array<{ requestHash: string; at: string }> {
  try {
    return JSON.parse(localStorage.getItem(INBOX_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function isForceFail(): boolean {
  return localStorage.getItem(FORCE_FAIL_KEY) === '1'
}

export function setForceFail(value: boolean): void {
  if (value) localStorage.setItem(FORCE_FAIL_KEY, '1')
  else localStorage.removeItem(FORCE_FAIL_KEY)
}

export function readInboxHashes(): string[] {
  return readInbox().map((item) => item.requestHash)
}

export async function publishPackage(payload: { requestHash: string; packageName: string; attempt: number }): Promise<PublishedReceipt> {
  await new Promise((resolve) => window.setTimeout(resolve, 650))
  if (isForceFail()) {
    throw new Error(`第 ${payload.attempt} 次发布失败：回连链路中断（模拟），上一包与检查点已保留`)
  }
  const inbox = readInbox()
  const existing = inbox.find((item) => item.requestHash === payload.requestHash)
  if (existing) return { requestHash: payload.requestHash, duplicate: true, at: existing.at }
  const at = new Date().toISOString()
  inbox.push({ requestHash: payload.requestHash, at })
  localStorage.setItem(INBOX_KEY, JSON.stringify(inbox))
  return { requestHash: payload.requestHash, duplicate: false, at }
}
