// IPC payload for the batch Remove Audio module.

export interface RemoveAudioStartPayload {
  inputs: string[]
  /** Output directory; empty means next to each source file. */
  outputDir?: string
}

export interface RemoveAudioStartResult {
  /** One FFmpeg task per source video containing an audio stream. */
  taskIds: string[]
  /** Files that could not be read as videos. */
  skipped: string[]
  /** Valid videos that already have no audio stream. */
  alreadySilent: string[]
}
