export type PhotokeyColor = 'green' | 'blue'

export interface PhotokeyEngineOptions {
  color: PhotokeyColor
  tolLow: number
  tolHigh: number
  choke: number
  feather: number
  despill: number
}

export type PhotokeyStepCallback = (step: number) => void
/** Trả true để dừng xử lý (engine sẽ throw 'Tác vụ đã bị huỷ'). */
export type PhotokeyCancelCheck = () => boolean

const BYTE_MAX = 255
const MIN_ALPHA_DIVISOR = 0.05
/** Số pixel tối đa mỗi lát trước khi nhả event loop (~vài ms mỗi lát trên CPU phổ thông). */
const SLICE_PIXELS = 2_000_000
const CANCEL_MESSAGE = 'Tác vụ đã bị huỷ'

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} phải là một số hữu hạn`)
}

function validateInputs(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: PhotokeyEngineOptions,
  onStep?: PhotokeyStepCallback,
  checkCancel?: PhotokeyCancelCheck
): number {
  if (!(rgba instanceof Uint8Array)) throw new TypeError('rgba phải là Uint8Array')
  if (!Number.isSafeInteger(width) || width <= 0) {
    throw new RangeError('width phải là số nguyên dương an toàn')
  }
  if (!Number.isSafeInteger(height) || height <= 0) {
    throw new RangeError('height phải là số nguyên dương an toàn')
  }
  if (width > Math.floor(Number.MAX_SAFE_INTEGER / height)) {
    throw new RangeError('Kích thước ảnh quá lớn')
  }

  const pixelCount = width * height
  if (pixelCount > Math.floor(Number.MAX_SAFE_INTEGER / 4)) {
    throw new RangeError('Kích thước ảnh quá lớn')
  }
  const expectedBytes = pixelCount * 4
  if (rgba.length !== expectedBytes) {
    throw new RangeError(`Dữ liệu RGBA phải có đúng ${expectedBytes} byte`)
  }

  if (!options || (options.color !== 'green' && options.color !== 'blue')) {
    throw new TypeError("color phải là 'green' hoặc 'blue'")
  }
  assertFinite('tolLow', options.tolLow)
  assertFinite('tolHigh', options.tolHigh)
  assertFinite('choke', options.choke)
  assertFinite('feather', options.feather)
  assertFinite('despill', options.despill)

  if (options.tolLow < 0 || options.tolLow > 1) {
    throw new RangeError('tolLow phải nằm trong khoảng 0..1')
  }
  if (options.tolHigh < 0 || options.tolHigh > 1) {
    throw new RangeError('tolHigh phải nằm trong khoảng 0..1')
  }
  if (options.despill < 0 || options.despill > 1) {
    throw new RangeError('despill phải nằm trong khoảng 0..1')
  }
  if (!Number.isInteger(options.choke) || options.choke < 0 || options.choke > 5) {
    throw new RangeError('choke phải là số nguyên trong khoảng 0..5')
  }
  if (!Number.isInteger(options.feather) || options.feather < 0 || options.feather > 5) {
    throw new RangeError('feather phải là số nguyên trong khoảng 0..5')
  }
  if (onStep !== undefined && typeof onStep !== 'function') {
    throw new TypeError('onStep phải là một hàm')
  }
  if (checkCancel !== undefined && typeof checkCancel !== 'function') {
    throw new TypeError('checkCancel phải là một hàm')
  }

  return pixelCount
}

/* Các pass đều tách được theo dải hàng [y0, y1): pass ngang độc lập từng hàng,
   pass dọc đọc source (buffer riêng) ở hàng lân cận nên chia dải vẫn cho kết quả
   giống hệt bản chạy nguyên khối. */

function erodeHorizontalRows(
  source: Float32Array,
  target: Float32Array,
  width: number,
  y0: number,
  y1: number
): void {
  if (width === 1) {
    for (let y = y0; y < y1; y++) target[y] = source[y]
    return
  }

  for (let y = y0; y < y1; y++) {
    const row = y * width
    target[row] = Math.min(source[row], source[row + 1])

    const last = row + width - 1
    for (let i = row + 1; i < last; i++) {
      target[i] = Math.min(source[i - 1], source[i], source[i + 1])
    }
    target[last] = Math.min(source[last - 1], source[last])
  }
}

function erodeVerticalRows(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  y0: number,
  y1: number
): void {
  for (let y = y0; y < y1; y++) {
    const row = y * width
    const up = y > 0 ? -width : 0
    const down = y < height - 1 ? width : 0
    for (let x = 0; x < width; x++) {
      const i = row + x
      target[i] = Math.min(source[i + up], source[i], source[i + down])
    }
  }
}

function blurHorizontalRows(
  source: Float32Array,
  target: Float32Array,
  width: number,
  y0: number,
  y1: number
): void {
  if (width === 1) {
    for (let y = y0; y < y1; y++) target[y] = source[y]
    return
  }

  for (let y = y0; y < y1; y++) {
    const row = y * width
    target[row] = (source[row] * 2 + source[row + 1]) / 3

    const last = row + width - 1
    for (let i = row + 1; i < last; i++) {
      target[i] = (source[i - 1] + source[i] + source[i + 1]) / 3
    }
    target[last] = (source[last - 1] + source[last] * 2) / 3
  }
}

function blurVerticalRows(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  y0: number,
  y1: number
): void {
  for (let y = y0; y < y1; y++) {
    const row = y * width
    const up = y > 0 ? -width : 0
    const down = y < height - 1 ? width : 0
    for (let x = 0; x < width; x++) {
      const i = row + x
      target[i] = (source[i + up] + source[i] + source[i + down]) / 3
    }
  }
}

function clampUnit(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function toByte(value: number): number {
  const rounded = Math.round(value * BYTE_MAX)
  if (rounded <= 0) return 0
  if (rounded >= BYTE_MAX) return BYTE_MAX
  return rounded
}

/**
 * Remove a green or blue screen from one tightly packed RGBA frame.
 *
 * The input buffer is reused for the result to keep peak memory bounded for
 * large still images. Its original alpha channel is intentionally replaced,
 * matching the source engine's conversion to RGB before generating new alpha.
 *
 * Async có chủ đích: xử lý theo lát ~SLICE_PIXELS rồi nhả event loop, để main
 * process của Electron vẫn phục vụ IPC/tiến độ/Cancel trong lúc chạy (ảnh nhỏ
 * gọn trong 1 lát nên không mất chi phí yield).
 */
export async function removeBackgroundRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: PhotokeyEngineOptions,
  onStep?: PhotokeyStepCallback,
  checkCancel?: PhotokeyCancelCheck
): Promise<Uint8Array> {
  const pixelCount = validateInputs(rgba, width, height, options, onStep, checkCancel)
  const keyOffset = options.color === 'green' ? 1 : 2
  const otherOffset1 = 0
  const otherOffset2 = options.color === 'green' ? 2 : 1

  const rowsPerSlice = Math.max(1, Math.floor(SLICE_PIXELS / width))
  const runBanded = async (fn: (y0: number, y1: number) => void): Promise<void> => {
    for (let y0 = 0; y0 < height; y0 += rowsPerSlice) {
      fn(y0, Math.min(height, y0 + rowsPerSlice))
      if (checkCancel?.()) throw new Error(CANCEL_MESSAGE)
      if (y0 + rowsPerSlice < height) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
  }

  // 1) Dominance.
  const dominance = new Float32Array(pixelCount)
  await runBanded((y0, y1) => {
    const end = y1 * width
    for (let pixel = y0 * width, byte = pixel * 4; pixel < end; pixel++, byte += 4) {
      const key = rgba[byte + keyOffset]
      const other1 = rgba[byte + otherOffset1]
      const other2 = rgba[byte + otherOffset2]
      dominance[pixel] = (key - Math.max(other1, other2)) / BYTE_MAX
    }
  })
  onStep?.(1)

  // 2) Soft alpha via smoothstep. The epsilon mirrors the source engine.
  const alpha = new Float32Array(pixelCount)
  const toleranceSpan = Math.max(options.tolHigh - options.tolLow, 1e-6)
  await runBanded((y0, y1) => {
    const end = y1 * width
    for (let pixel = y0 * width; pixel < end; pixel++) {
      let x = (dominance[pixel] - options.tolLow) / toleranceSpan
      if (x < 0) x = 0
      else if (x > 1) x = 1
      alpha[pixel] = 1 - x * x * (3 - 2 * x)
    }
  })
  onStep?.(2)

  // 3) Estimate the real screen color from pixels that are confidently background.
  const sureBackgroundThreshold = options.tolHigh * 0.9
  let redSum = 0
  let greenSum = 0
  let blueSum = 0
  let backgroundCount = 0
  await runBanded((y0, y1) => {
    const end = y1 * width
    for (let pixel = y0 * width, byte = pixel * 4; pixel < end; pixel++, byte += 4) {
      if (dominance[pixel] > sureBackgroundThreshold) {
        redSum += rgba[byte]
        greenSum += rgba[byte + 1]
        blueSum += rgba[byte + 2]
        backgroundCount++
      }
    }
  })

  let keyRed: number
  let keyGreen: number
  let keyBlue: number
  if (backgroundCount > 0) {
    const divisor = backgroundCount * BYTE_MAX
    keyRed = redSum / divisor
    keyGreen = greenSum / divisor
    keyBlue = blueSum / divisor
  } else if (options.color === 'green') {
    keyRed = 0
    keyGreen = 1
    keyBlue = 0
  } else {
    keyRed = 0
    keyGreen = 0
    keyBlue = 1
  }
  onStep?.(3)

  // dominance is no longer needed, so reuse it as the separable-filter scratch buffer.
  const scratch = dominance

  // 4) Choke: separable 3x3 erosion with replicated edges.
  const chokeIterations = options.choke
  for (let iteration = 0; iteration < chokeIterations; iteration++) {
    await runBanded((y0, y1) => erodeHorizontalRows(alpha, scratch, width, y0, y1))
    await runBanded((y0, y1) => erodeVerticalRows(scratch, alpha, width, height, y0, y1))
  }
  onStep?.(4)

  // 5) Feather: separable 3x3 box blur with replicated edges, then clamp.
  const featherIterations = options.feather
  for (let iteration = 0; iteration < featherIterations; iteration++) {
    await runBanded((y0, y1) => blurHorizontalRows(alpha, scratch, width, y0, y1))
    await runBanded((y0, y1) => blurVerticalRows(scratch, alpha, width, height, y0, y1))
  }
  await runBanded((y0, y1) => {
    const end = y1 * width
    for (let pixel = y0 * width; pixel < end; pixel++) {
      alpha[pixel] = clampUnit(alpha[pixel])
    }
  })
  onStep?.(5)

  // 6) Un-mix edge pixels. Reuse scratch for red to avoid a fourth RGB buffer.
  const red = scratch
  const green = new Float32Array(pixelCount)
  const blue = new Float32Array(pixelCount)
  await runBanded((y0, y1) => {
    const end = y1 * width
    for (let pixel = y0 * width, byte = pixel * 4; pixel < end; pixel++, byte += 4) {
      const a = alpha[pixel]
      let r = rgba[byte] / BYTE_MAX
      let g = rgba[byte + 1] / BYTE_MAX
      let b = rgba[byte + 2] / BYTE_MAX

      if (a > 0.01 && a < 0.99) {
        const inverseAlpha = 1 - a
        const divisor = Math.max(a, MIN_ALPHA_DIVISOR)
        r = clampUnit((r - inverseAlpha * keyRed) / divisor)
        g = clampUnit((g - inverseAlpha * keyGreen) / divisor)
        b = clampUnit((b - inverseAlpha * keyBlue) / divisor)
      }

      red[pixel] = r
      green[pixel] = g
      blue[pixel] = b
    }
  })
  onStep?.(6)

  // 7) Despill from the already un-mixed RGB values.
  if (options.despill > 0) {
    if (options.color === 'green') {
      await runBanded((y0, y1) => {
        const end = y1 * width
        for (let pixel = y0 * width; pixel < end; pixel++) {
          const key = green[pixel]
          const spill = key - Math.max(red[pixel], blue[pixel])
          if (spill > 0) green[pixel] = key - spill * options.despill
        }
      })
    } else {
      await runBanded((y0, y1) => {
        const end = y1 * width
        for (let pixel = y0 * width; pixel < end; pixel++) {
          const key = blue[pixel]
          const spill = key - Math.max(red[pixel], green[pixel])
          if (spill > 0) blue[pixel] = key - spill * options.despill
        }
      })
    }
  }
  onStep?.(7)

  // Final RGBA conversion: round(value * 255), then clamp to byte range.
  await runBanded((y0, y1) => {
    const end = y1 * width
    for (let pixel = y0 * width, byte = pixel * 4; pixel < end; pixel++, byte += 4) {
      rgba[byte] = toByte(red[pixel])
      rgba[byte + 1] = toByte(green[pixel])
      rgba[byte + 2] = toByte(blue[pixel])
      rgba[byte + 3] = toByte(alpha[pixel])
    }
  })

  return rgba
}
