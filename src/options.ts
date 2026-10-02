import type { RevisionColor } from './types'

export const revisionOptions: Array<{ value: RevisionColor; label: string; color: string }> = [
  { value: 'white', label: '白纸', color: '#f7f5ee' },
  { value: 'blue', label: '蓝', color: '#7da6c9' },
  { value: 'pink', label: '粉', color: '#e7a2b2' },
  { value: 'yellow', label: '黄', color: '#ead56e' },
  { value: 'green', label: '绿', color: '#86bd91' },
  { value: 'goldenrod', label: '金菊', color: '#c99e37' },
  { value: 'buff', label: '浅黄', color: '#deb887' },
  { value: 'salmon', label: '鲑粉', color: '#e9967a' },
  { value: 'cherry', label: '樱桃', color: '#d65a64' }
]

export const revisionLabel = (value: RevisionColor): string =>
  revisionOptions.find((option) => option.value === value)?.label ?? value

export const dayNightOptions = ['白天', '夜', '清晨', '黄昏', '傍晚']
export const timePeriods = ['白天', '夜', '清晨', '黄昏', '傍晚']
