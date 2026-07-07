import { execFile } from 'node:child_process'
import type { HwInfo } from '@shared/types'
import { resolveBin } from './binaries'
import { settings } from './settings-store'

const CANDIDATES_H264 = ['h264_nvenc', 'h264_qsv', 'h264_amf']
const CANDIDATES_HEVC = ['hevc_nvenc', 'hevc_qsv', 'hevc_amf']

function execP(cmd: string, args: string[], timeout = 20000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout}\n${stderr}` })
    })
  })
}

async function listGpus(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const { out } = await execP('powershell', [
    '-NoProfile',
    '-Command',
    '(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join "`n"'
  ])
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Test encoder thật sự chạy được bằng một lệnh encode 8 frame vào null (spec 5.1). */
async function encoderWorks(ffmpeg: string, enc: string): Promise<boolean> {
  const { ok } = await execP(ffmpeg, [
    '-hide_banner',
    '-v', 'error',
    '-f', 'lavfi',
    '-i', 'color=size=320x240:rate=30:duration=0.5',
    '-frames:v', '8',
    '-c:v', enc,
    '-f', 'null',
    '-'
  ])
  return ok
}

let inFlight: Promise<HwInfo> | null = null

/**
 * Dò encoder phần cứng NVENC → QSV → AMF, fallback libx264/libx265 (spec 5.1).
 * Kết quả cache vào settings; force=true để dò lại.
 */
export async function detectHardware(force = false): Promise<HwInfo> {
  const cached = settings.all().hw
  if (cached && !force) return cached
  if (inFlight) return inFlight

  inFlight = (async (): Promise<HwInfo> => {
    const ffmpeg = resolveBin('ffmpeg')
    const gpus = await listGpus()
    if (!ffmpeg) {
      const info: HwInfo = {
        gpus,
        best: { h264: 'libx264', hevc: 'libx265' },
        available: [],
        testedAt: Date.now()
      }
      return info
    }
    const { out } = await execP(ffmpeg, ['-hide_banner', '-encoders'])
    const listed = new Set(
      [...out.matchAll(/^\s*V[\w.]*\s+(\S+)/gm)].map((m) => m[1])
    )
    const available: string[] = []
    let h264 = 'libx264'
    let hevc = 'libx265'
    for (const enc of CANDIDATES_H264) {
      if (listed.has(enc) && (await encoderWorks(ffmpeg, enc))) {
        available.push(enc)
        if (h264 === 'libx264') h264 = enc
      }
    }
    for (const enc of CANDIDATES_HEVC) {
      if (listed.has(enc) && (await encoderWorks(ffmpeg, enc))) {
        available.push(enc)
        if (hevc === 'libx265') hevc = enc
      }
    }
    const info: HwInfo = { gpus, best: { h264, hevc }, available, testedAt: Date.now() }
    settings.set({ hw: info })
    return info
  })()

  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

/**
 * Chọn encoder theo cấu hình user (auto = tốt nhất đã dò).
 * codec: 'h264' | 'hevc'
 */
export async function pickEncoder(codec: 'h264' | 'hevc'): Promise<string> {
  const pref = settings.all().encoderPref
  const soft = codec === 'h264' ? 'libx264' : 'libx265'
  if (pref === 'x264') return soft
  const hw = await detectHardware()
  if (pref === 'auto') return hw.best[codec]
  const want = codec + '_' + { nvenc: 'nvenc', qsv: 'qsv', amf: 'amf' }[pref]
  return hw.available.includes(want) ? want : hw.best[codec]
}
