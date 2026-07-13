import type { AuthAccount, AuthStatus, AuthUpdate, AuthUpdateReason } from '@shared/types'
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { userDataDir } from './env'
import { getMachineHwid } from './machine-id'

const DEFAULT_API_BASE_URL = 'https://tools.amnhacso.com'
const DEFAULT_CLIENT_API_KEY = 'ANS@video123'
const LOGIN_PATH = '/api/ans-video/login'
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 256 * 1024
const MAX_TIMER_DELAY_MS = 2_147_483_647
const REMEMBER_LOGIN_MS = 48 * 60 * 60 * 1_000
const REMEMBER_CLOCK_SKEW_MS = 5 * 60 * 1_000
const MAX_REMEMBER_FILE_BYTES = 64 * 1024
const REMEMBER_FILE = path.join(userDataDir, 'auth-remember.v1')
const REMEMBER_LOGIN_ENABLED =
  process.env.VT_SMOKE !== '1' || process.env.VT_SMOKE_AUTH_REMEMBER === '1'

const ISO_8601_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/

type AuthListener = (update: AuthUpdate) => unknown

interface LoginInput {
  username: string
  password: string
}

interface RememberedLogin extends LoginInput {
  version: 1
  createdAtMs: number
  rememberUntilMs: number
}

interface ApiErrorShape {
  error?: unknown
}

class AuthenticationError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'AuthenticationError'
  }
}

const ERROR_MESSAGES_VI: Readonly<Record<string, string>> = {
  MISSING_API_KEY: 'Ứng dụng chưa gửi khóa API xác thực. Vui lòng liên hệ hỗ trợ.',
  INVALID_API_KEY: 'Khóa API của ứng dụng không hợp lệ. Vui lòng liên hệ hỗ trợ.',
  API_KEY_NOT_CONFIGURED: 'Máy chủ chưa cấu hình khóa API cho ANS-Video.',
  WEAK_API_KEY_CONFIGURATION: 'Khóa API trên máy chủ không đáp ứng yêu cầu bảo mật.',
  API_KEY_CONFIGURATION_CONFLICT: 'Cấu hình khóa API trên máy chủ đang bị xung đột.',
  CONFLICTING_FIELDS: 'Thông tin đăng nhập gửi lên bị xung đột.',
  INVALID_USERNAME: 'Tên tài khoản không hợp lệ.',
  INVALID_PASSWORD: 'Mật khẩu không hợp lệ.',
  INVALID_HWID: 'Mã thiết bị không hợp lệ.',
  HWID_REQUIRED: 'Không thể xác định mã thiết bị để đăng nhập.',
  INVALID_CREDENTIALS: 'Sai tài khoản hoặc mật khẩu.',
  EMAIL_NOT_VERIFIED: 'Tài khoản chưa xác minh email.',
  ACCOUNT_BLOCKED: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.',
  ACCOUNT_EXPIRED: 'Tài khoản đã hết hạn. Vui lòng liên hệ quản trị viên để gia hạn.',
  ACCOUNT_INACTIVE: 'Tài khoản đang bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.',
  HWID_MISMATCH: 'Tài khoản đã được liên kết với một máy tính khác.',
  HWID_BIND_IN_PROGRESS: 'Thiết bị đang được liên kết bởi một yêu cầu khác. Vui lòng thử lại.',
  ORPHANED_ACCOUNT_LINK: 'Liên kết tài khoản không còn hợp lệ. Vui lòng liên hệ quản trị viên.',
  TOO_MANY_LOGIN_ATTEMPTS: 'Bạn đã đăng nhập sai quá nhiều lần. Vui lòng chờ rồi thử lại.',
  LOGIN_RATE_LIMIT_CAPACITY_REACHED: 'Máy chủ đang tạm giới hạn đăng nhập. Vui lòng thử lại sau.',
  INTERNAL_ERROR: 'Máy chủ xác thực gặp lỗi. Vui lòng thử lại sau.'
}

const FORGET_LOGIN_ERROR_CODES = new Set([
  'INVALID_CREDENTIALS',
  'EMAIL_NOT_VERIFIED',
  'ACCOUNT_BLOCKED',
  'ACCOUNT_EXPIRED',
  'ACCOUNT_INACTIVE',
  'INVALID_HWID',
  'HWID_REQUIRED',
  'HWID_MISMATCH',
  'ORPHANED_ACCOUNT_LINK',
  'ACCOUNT_CHANGED',
  'REMEMBERED_LOGIN_EXPIRED'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneAccount(account: AuthAccount | null): AuthAccount | null {
  return account ? { ...account } : null
}

function cloneStatus(status: AuthStatus): AuthStatus {
  return {
    authenticated: status.authenticated,
    hwid: status.hwid,
    account: cloneAccount(status.account)
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

function parseIsoTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = ISO_8601_WITH_ZONE.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const zoneHour = match[9] === undefined ? 0 : Number(match[9])
  const zoneMinute = match[10] === undefined ? 0 : Number(match[10])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    zoneHour > 14 ||
    zoneMinute > 59 ||
    (zoneHour === 14 && zoneMinute !== 0)
  ) {
    return null
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseRememberedLogin(value: unknown, now: number): RememberedLogin | null {
  if (!isRecord(value)) return null

  const username = value.username
  const password = value.password
  const createdAtMs = value.createdAtMs
  const rememberUntilMs = value.rememberUntilMs
  if (
    value.version !== 1 ||
    typeof username !== 'string' ||
    !username.trim() ||
    username !== username.trim() ||
    username.length > 128 ||
    typeof password !== 'string' ||
    !password ||
    password.length > 1024 ||
    !Number.isSafeInteger(createdAtMs) ||
    !Number.isSafeInteger(rememberUntilMs) ||
    (createdAtMs as number) <= 0 ||
    (rememberUntilMs as number) <= now ||
    (rememberUntilMs as number) <= (createdAtMs as number) ||
    (rememberUntilMs as number) - (createdAtMs as number) > REMEMBER_LOGIN_MS ||
    (createdAtMs as number) > now + REMEMBER_CLOCK_SKEW_MS
  ) {
    return null
  }

  return {
    version: 1,
    username,
    password,
    createdAtMs: createdAtMs as number,
    rememberUntilMs: rememberUntilMs as number
  }
}

function shouldForgetRememberedLogin(error: unknown): boolean {
  return error instanceof AuthenticationError && FORGET_LOGIN_ERROR_CODES.has(error.code)
}

function resolveLoginUrl(): string {
  // Bản phát hành luôn khóa origin; env override chỉ phục vụ dev/smoke test.
  const configured = app.isPackaged ? '' : process.env.ANS_VIDEO_API_BASE_URL?.trim()
  const base = (configured || DEFAULT_API_BASE_URL).replace(/\/+$/, '')

  try {
    const parsed = new URL(base)
    const hostname = parsed.hostname.toLowerCase()
    const isLoopback =
      hostname === 'localhost' ||
      hostname === 'localhost.' ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname === '::1' ||
      hostname === '[::1]'
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      base.includes('?') ||
      base.includes('#')
    ) {
      throw new Error()
    }
    if (parsed.protocol === 'http:' && !isLoopback) throw new Error()
  } catch {
    throw new AuthenticationError(
      'Địa chỉ máy chủ xác thực không hợp lệ hoặc không dùng kết nối HTTPS an toàn.',
      'INVALID_API_BASE_URL'
    )
  }

  return `${base}${LOGIN_PATH}`
}

function resolveClientApiKey(): string {
  const configured = app.isPackaged ? '' : process.env.ANS_VIDEO_CLIENT_API_KEY?.trim()
  const key = configured || DEFAULT_CLIENT_API_KEY
  if (key.length < 9) {
    throw new AuthenticationError('Khóa API của ứng dụng không hợp lệ. Vui lòng liên hệ hỗ trợ.', 'INVALID_API_KEY')
  }
  return key
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length')
  const declaredLength = contentLength === null ? null : Number(contentLength)
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    try {
      await response.body?.cancel()
    } catch {
      // Body không còn cần thiết; response quá lớn luôn bị từ chối.
    }
    return null
  }

  if (!response.body) return null
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let receivedBytes = 0
  let text = ''

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      receivedBytes += chunk.value.byteLength
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // Không giữ connection/body của response bị từ chối.
        }
        return null
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }

  if (!text) return null

  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function apiErrorCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const error = (payload as ApiErrorShape).error
  return typeof error === 'string' && error ? error : null
}

function loginFailure(response: Response, payload: unknown): AuthenticationError {
  const code = apiErrorCode(payload) ?? `HTTP_${response.status}`
  let message = ERROR_MESSAGES_VI[code]

  if (!message) {
    if (response.status === 401) message = ERROR_MESSAGES_VI.INVALID_CREDENTIALS
    else if (response.status === 403) message = 'Máy chủ từ chối quyền đăng nhập của tài khoản này.'
    else if (response.status === 429) message = ERROR_MESSAGES_VI.TOO_MANY_LOGIN_ATTEMPTS
    else if (response.status >= 500) message = 'Máy chủ xác thực đang gặp sự cố. Vui lòng thử lại sau.'
    else message = 'Đăng nhập thất bại. Vui lòng kiểm tra thông tin và thử lại.'
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after')
    if (retryAfter && /^\d+$/.test(retryAfter)) message += ` Có thể thử lại sau ${retryAfter} giây.`
  }

  return new AuthenticationError(message, code)
}

function parseAuthenticatedAccount(
  payload: unknown,
  expectedUsername: string,
  expectedHwid: string,
  now: number
): { account: AuthAccount; expiresAtMs: number } {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.account)) {
    throw new AuthenticationError('Phản hồi xác thực từ máy chủ không hợp lệ.', 'INVALID_AUTH_RESPONSE')
  }

  const account = payload.account
  const id = account.id
  const username = account.Use
  const status = account.Status
  const hwid = account.hwid
  const activatedAt = account.activated_at
  const expiresAt = account.expires_at
  const remainingSeconds = account.remaining_seconds
  const remainingDays = account.remaining_days

  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof username !== 'string' ||
    !username.trim() ||
    username.trim().toLocaleLowerCase('en-US') !== expectedUsername.toLocaleLowerCase('en-US') ||
    status !== 'activate' ||
    hwid !== expectedHwid ||
    !isNonNegativeInteger(remainingSeconds) ||
    !isNonNegativeInteger(remainingDays)
  ) {
    throw new AuthenticationError('Phản hồi xác thực từ máy chủ không hợp lệ.', 'INVALID_AUTH_RESPONSE')
  }

  if (activatedAt !== null && (typeof activatedAt !== 'string' || parseIsoTimestamp(activatedAt) === null)) {
    throw new AuthenticationError('Phản hồi xác thực từ máy chủ không hợp lệ.', 'INVALID_AUTH_RESPONSE')
  }

  const expiresAtMs = parseIsoTimestamp(expiresAt)
  if (typeof expiresAt !== 'string' || expiresAtMs === null || expiresAtMs <= now) {
    throw new AuthenticationError(
      expiresAtMs === null
        ? 'Phản hồi xác thực từ máy chủ không hợp lệ.'
        : ERROR_MESSAGES_VI.ACCOUNT_EXPIRED,
      expiresAtMs === null ? 'INVALID_AUTH_RESPONSE' : 'ACCOUNT_EXPIRED'
    )
  }

  return {
    account: {
      id,
      username: username.trim(),
      status: 'activate',
      hwid,
      activatedAt: activatedAt as string | null,
      expiresAt,
      remainingSeconds,
      remainingDays
    },
    expiresAtMs
  }
}

class AuthSession {
  private account: AuthAccount | null = null
  private expiresAtMs: number | null = null
  private expiresAtMonotonicMs: number | null = null
  private expiryTimer: NodeJS.Timeout | null = null
  private rememberExpiryTimer: NodeJS.Timeout | null = null
  private activeLoginController: AbortController | null = null
  private loginGeneration = 0
  private initialized = false
  private initializationPromise: Promise<AuthStatus> | null = null
  private readonly listeners = new Set<AuthListener>()
  private readonly pendingUpdates: AuthUpdate[] = []
  private dispatchingUpdates = false

  async initialize(): Promise<AuthStatus> {
    if (this.initialized || !REMEMBER_LOGIN_ENABLED) {
      this.initialized = true
      return this.status()
    }
    if (this.initializationPromise) return this.initializationPromise

    const initialization = this.restoreRememberedLogin()
    this.initializationPromise = initialization
    try {
      return await initialization
    } finally {
      if (this.initializationPromise === initialization) this.initializationPromise = null
    }
  }

  status(): AuthStatus {
    this.expireIfNeeded()
    return this.snapshot()
  }

  async login(input: LoginInput): Promise<AuthStatus> {
    this.initialized = true
    this.forgetRememberedLogin(true)
    return this.authenticate(input, true)
  }

  private async authenticate(
    input: LoginInput,
    rememberOnSuccess: boolean,
    rememberedLoginDeadlineMs: number | null = null
  ): Promise<AuthStatus> {
    const generation = ++this.loginGeneration
    this.activeLoginController?.abort()
    this.activeLoginController = null
    if (this.account) this.clearSession('logout')
    if (generation !== this.loginGeneration) {
      throw new AuthenticationError('Yêu cầu đăng nhập đã bị hủy.', 'LOGIN_CANCELLED')
    }

    const username = typeof input?.username === 'string' ? input.username.trim() : ''
    const password = typeof input?.password === 'string' ? input.password : ''
    if (!username || username.length > 128) {
      throw new AuthenticationError(ERROR_MESSAGES_VI.INVALID_USERNAME, 'INVALID_USERNAME')
    }
    if (!password || password.length > 1024) {
      throw new AuthenticationError(ERROR_MESSAGES_VI.INVALID_PASSWORD, 'INVALID_PASSWORD')
    }

    const hwid = getMachineHwid()
    const url = resolveLoginUrl()
    const apiKey = resolveClientApiKey()
    if (generation !== this.loginGeneration) {
      throw new AuthenticationError('Yêu cầu đăng nhập đã bị hủy.', 'LOGIN_CANCELLED')
    }

    const controller = new AbortController()
    this.activeLoginController = controller
    let didTimeout = false
    const timeout = setTimeout(() => {
      didTimeout = true
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    timeout.unref?.()

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify({ username, password, hwid }),
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      })
      const payload = await readJsonSafely(response)

      if (generation !== this.loginGeneration) {
        throw new AuthenticationError('Yêu cầu đăng nhập đã bị hủy.', 'LOGIN_CANCELLED')
      }
      if (!response.ok || response.status !== 200) throw loginFailure(response, payload)

      const now = Date.now()
      const authenticated = parseAuthenticatedAccount(payload, username, hwid, now)
      const lifetimeMs = Math.min(
        authenticated.expiresAtMs - now,
        authenticated.account.remainingSeconds * 1_000
      )
      if (lifetimeMs <= 0) {
        throw new AuthenticationError(ERROR_MESSAGES_VI.ACCOUNT_EXPIRED, 'ACCOUNT_EXPIRED')
      }
      if (rememberedLoginDeadlineMs !== null && Date.now() >= rememberedLoginDeadlineMs) {
        throw new AuthenticationError('Thông tin đăng nhập đã lưu đã hết hạn.', 'REMEMBERED_LOGIN_EXPIRED')
      }

      const storedAccount = Object.freeze(authenticated.account)
      this.account = storedAccount
      this.expiresAtMs = authenticated.expiresAtMs
      this.expiresAtMonotonicMs = performance.now() + lifetimeMs
      this.scheduleExpiry()

      if (generation !== this.loginGeneration) {
        throw new AuthenticationError('Yêu cầu đăng nhập đã bị hủy.', 'LOGIN_CANCELLED')
      }
      if (this.account !== storedAccount) {
        throw new AuthenticationError(ERROR_MESSAGES_VI.ACCOUNT_EXPIRED, 'ACCOUNT_EXPIRED')
      }
      if (rememberOnSuccess) this.rememberLogin(username, password, now)
      this.emit('login')
      if (generation !== this.loginGeneration || this.account !== storedAccount) {
        throw new AuthenticationError('Yêu cầu đăng nhập đã bị hủy.', 'LOGIN_CANCELLED')
      }
      return this.snapshot()
    } catch (error) {
      if (error instanceof AuthenticationError) throw error
      if (didTimeout) {
        throw new AuthenticationError('Máy chủ xác thực không phản hồi trong 10 giây. Vui lòng thử lại.', 'LOGIN_TIMEOUT')
      }
      if (controller.signal.aborted || generation !== this.loginGeneration) {
        throw new AuthenticationError('Yêu cầu đăng nhập đã bị hủy.', 'LOGIN_CANCELLED')
      }
      throw new AuthenticationError('Không thể kết nối máy chủ xác thực. Vui lòng kiểm tra kết nối.', 'NETWORK_ERROR')
    } finally {
      clearTimeout(timeout)
      if (this.activeLoginController === controller) this.activeLoginController = null
    }
  }

  private async restoreRememberedLogin(): Promise<AuthStatus> {
    const remembered = this.readRememberedLogin()
    if (remembered === null) {
      this.initialized = true
      return this.status()
    }
    if (remembered === undefined) {
      throw new AuthenticationError(
        'Không thể mở thông tin đăng nhập đã mã hóa. Vui lòng thử lại hoặc đăng nhập thủ công.',
        'SECURE_STORAGE_UNAVAILABLE'
      )
    }

    this.scheduleRememberedLoginExpiry(remembered.rememberUntilMs)
    try {
      const status = await this.authenticate(
        { username: remembered.username, password: remembered.password },
        false,
        remembered.rememberUntilMs
      )
      this.initialized = true
      return status
    } catch (error) {
      if (shouldForgetRememberedLogin(error)) {
        this.forgetRememberedLogin(true)
        this.initialized = true
      }
      throw error
    }
  }

  /** `undefined` nghĩa là kho mã hóa tạm thời chưa khả dụng; không xóa file để còn thử lại. */
  private readRememberedLogin(): RememberedLogin | null | undefined {
    if (!REMEMBER_LOGIN_ENABLED || !fs.existsSync(REMEMBER_FILE)) return null
    if (!safeStorage.isEncryptionAvailable()) return undefined

    try {
      const stats = fs.statSync(REMEMBER_FILE)
      if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_REMEMBER_FILE_BYTES) {
        this.forgetRememberedLogin()
        return null
      }

      const decrypted = safeStorage.decryptString(fs.readFileSync(REMEMBER_FILE))
      const remembered = parseRememberedLogin(JSON.parse(decrypted) as unknown, Date.now())
      if (!remembered) {
        this.forgetRememberedLogin()
        return null
      }
      return remembered
    } catch {
      this.forgetRememberedLogin()
      return null
    }
  }

  private rememberLogin(username: string, password: string, createdAtMs: number): void {
    if (!REMEMBER_LOGIN_ENABLED || !safeStorage.isEncryptionAvailable()) return

    const remembered: RememberedLogin = {
      version: 1,
      username,
      password,
      createdAtMs,
      rememberUntilMs: createdAtMs + REMEMBER_LOGIN_MS
    }
    const tempFile = `${REMEMBER_FILE}.${process.pid}.tmp`

    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(remembered))
      fs.mkdirSync(path.dirname(REMEMBER_FILE), { recursive: true })
      fs.writeFileSync(tempFile, encrypted, { mode: 0o600 })
      fs.renameSync(tempFile, REMEMBER_FILE)
      this.scheduleRememberedLoginExpiry(remembered.rememberUntilMs)
    } catch {
      try {
        fs.rmSync(tempFile, { force: true })
      } catch {
        // Không để lỗi dọn file tạm làm hỏng phiên đăng nhập đang dùng trong RAM.
      }
    }
  }

  private scheduleRememberedLoginExpiry(rememberUntilMs: number): void {
    this.clearRememberExpiryTimer()
    const remaining = rememberUntilMs - Date.now()
    if (remaining <= 0) {
      this.forgetRememberedLogin()
      return
    }

    this.rememberExpiryTimer = setTimeout(() => {
      this.rememberExpiryTimer = null
      this.forgetRememberedLogin()
    }, Math.min(remaining, MAX_TIMER_DELAY_MS))
    this.rememberExpiryTimer.unref?.()
  }

  private forgetRememberedLogin(strict = false): void {
    this.clearRememberExpiryTimer()
    if (!REMEMBER_LOGIN_ENABLED) return
    try {
      fs.rmSync(REMEMBER_FILE, { force: true })
    } catch {
      if (strict) {
        throw new AuthenticationError(
          'Không thể xóa thông tin đăng nhập đã lưu an toàn. Vui lòng đóng ứng dụng và thử lại.',
          'REMEMBERED_LOGIN_DELETE_FAILED'
        )
      }
      // File hết hạn/hỏng hoặc account bị server từ chối vẫn không thể cấp quyền ở lần đọc sau.
    }
  }

  logout(): AuthStatus {
    this.initialized = true
    const shouldEmit = this.account !== null || this.activeLoginController !== null
    this.loginGeneration++
    this.activeLoginController?.abort()
    this.activeLoginController = null
    this.forgetRememberedLogin(true)
    if (shouldEmit) {
      this.clearSession('logout')
    } else {
      this.clearExpiryTimer()
      this.account = null
      this.expiresAtMs = null
      this.expiresAtMonotonicMs = null
    }
    return this.snapshot()
  }

  assertAuthenticated(): AuthAccount {
    this.expireIfNeeded()
    if (!this.account) {
      throw new AuthenticationError('Bạn cần đăng nhập để sử dụng tính năng này.', 'AUTH_REQUIRED')
    }
    return { ...this.account }
  }

  subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.loginGeneration++
    this.activeLoginController?.abort()
    this.activeLoginController = null
    this.clearExpiryTimer()
    this.clearRememberExpiryTimer()
    this.account = null
    this.expiresAtMs = null
    this.expiresAtMonotonicMs = null
    this.pendingUpdates.length = 0
    this.listeners.clear()
  }

  private snapshot(): AuthStatus {
    return {
      authenticated: this.account !== null,
      hwid: getMachineHwid(),
      account: cloneAccount(this.account)
    }
  }

  private clearSession(reason: AuthUpdateReason): void {
    this.clearExpiryTimer()
    this.forgetRememberedLogin()
    this.account = null
    this.expiresAtMs = null
    this.expiresAtMonotonicMs = null
    this.emit(reason)
  }

  private expireIfNeeded(): boolean {
    if (!this.account) return false
    if (
      this.expiresAtMs !== null &&
      this.expiresAtMonotonicMs !== null &&
      this.expiresAtMs > Date.now() &&
      this.expiresAtMonotonicMs > performance.now()
    ) {
      return false
    }
    this.clearSession('expired')
    return true
  }

  private scheduleExpiry(): void {
    this.clearExpiryTimer()
    if (!this.account) return
    if (this.expiresAtMs === null || this.expiresAtMonotonicMs === null) {
      this.clearSession('expired')
      return
    }

    const remaining = Math.min(
      this.expiresAtMs - Date.now(),
      this.expiresAtMonotonicMs - performance.now()
    )
    if (remaining <= 0) {
      this.clearSession('expired')
      return
    }

    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null
      if (!this.expireIfNeeded()) this.scheduleExpiry()
    }, Math.min(remaining, MAX_TIMER_DELAY_MS))
    this.expiryTimer.unref?.()
  }

  private clearExpiryTimer(): void {
    if (!this.expiryTimer) return
    clearTimeout(this.expiryTimer)
    this.expiryTimer = null
  }

  private clearRememberExpiryTimer(): void {
    if (!this.rememberExpiryTimer) return
    clearTimeout(this.rememberExpiryTimer)
    this.rememberExpiryTimer = null
  }

  private emit(reason: AuthUpdateReason): void {
    this.pendingUpdates.push({ status: this.snapshot(), reason })
    if (this.dispatchingUpdates) return

    this.dispatchingUpdates = true
    try {
      while (this.pendingUpdates.length > 0) {
        const update = this.pendingUpdates.shift()
        if (!update) continue
        for (const listener of [...this.listeners]) {
          if (!this.listeners.has(listener)) continue
          try {
            const result = listener({ status: cloneStatus(update.status), reason: update.reason })
            if (isPromiseLike(result)) void Promise.resolve(result).catch(() => {})
          } catch {
            // Listener IPC/UI không được phép phá vỡ trạng thái xác thực trong main.
          }
        }
      }
    } finally {
      this.dispatchingUpdates = false
    }
  }
}

export const authSession = new AuthSession()
