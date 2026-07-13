import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const HWID_PREFIX = 'ANS-VIDEO-WIN-V1-'
const REGISTRY_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Cryptography'
const MACHINE_GUID_LINE = /^\s*MachineGuid\s+REG_SZ\s+(.+?)\s*$/im
const COMPACT_GUID = /^[0-9a-f]{32}$/i

let cachedHwid: string | null = null

function machineIdError(): Error {
  return new Error('Không thể xác định mã thiết bị Windows. Vui lòng khởi động lại ứng dụng hoặc liên hệ hỗ trợ.')
}

/** Chuẩn hóa GUID về dạng chữ thường 8-4-4-4-12 trước khi băm. */
function normalizeMachineGuid(value: string): string {
  const withoutBraces = value.trim().replace(/^\{(.+)\}$/, '$1')
  const compact = withoutBraces.replace(/-/g, '')
  if (!COMPACT_GUID.test(compact)) throw machineIdError()

  const guid = compact.toLowerCase()
  return [
    guid.slice(0, 8),
    guid.slice(8, 12),
    guid.slice(12, 16),
    guid.slice(16, 20),
    guid.slice(20)
  ].join('-')
}

function readMachineGuid(): string {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw machineIdError()

  const windowsDir = process.env.SystemRoot?.trim() || process.env.WINDIR?.trim()
  if (!windowsDir) throw machineIdError()

  const regExe = path.join(windowsDir, 'System32', 'reg.exe')
  let output: string
  try {
    output = execFileSync(
      regExe,
      ['query', REGISTRY_KEY, '/v', 'MachineGuid', '/reg:64'],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
        // Không truyền các biến môi trường của app (đặc biệt API key) cho process con.
        env: { SystemRoot: windowsDir, WINDIR: windowsDir }
      }
    )
  } catch {
    throw machineIdError()
  }

  const match = MACHINE_GUID_LINE.exec(output)
  if (!match?.[1]) throw machineIdError()
  return normalizeMachineGuid(match[1])
}

/**
 * HWID ổn định của máy Windows x64. Chỉ cache kết quả hợp lệ; mọi lỗi đọc
 * MachineGuid đều ném lỗi để luồng xác thực fail-closed, tuyệt đối không random.
 */
export function getMachineHwid(): string {
  if (cachedHwid) return cachedHwid

  const machineGuid = readMachineGuid()
  const digest = createHash('sha256').update(machineGuid, 'utf8').digest('hex')
  cachedHwid = `${HWID_PREFIX}${digest}`
  return cachedHwid
}
