import type { ModuleContext } from '../module-context'
import registerRender from './render'
import registerConvert from './convert'
import registerRemoveAudio from './remove-audio'
import registerUpscale from './upscale'
import registerIntroOutroLogo from './intro-outro-logo'
import registerSplit from './split'
import registerTrim from './trim'
import registerGreenScreen from './green-screen'
import registerPhotokey from './photokey'
import registerLoop from './loop'
import registerConcat from './concat'
import registerRandom from './random'
import registerRandomAudio from './random-audio'
import registerDownloader from './downloader'
import registerUpdater, { type UpdaterController } from './updater'

export interface ModuleControllers {
  updater: UpdaterController
}

/** Đăng ký toàn bộ module (spec mục 3.1). */
export function registerAllModules(ctx: ModuleContext): ModuleControllers {
  // Updater là cổng khởi động bắt buộc nên cần controller riêng để main/auth cùng chờ một promise.
  const updater = registerUpdater(ctx)
  const all: Array<[string, (c: ModuleContext) => void]> = [
    ['render', registerRender],
    ['convert', registerConvert],
    ['remove-audio', registerRemoveAudio],
    ['upscale', registerUpscale],
    ['intro-outro-logo', registerIntroOutroLogo],
    ['split', registerSplit],
    ['trim', registerTrim],
    ['green-screen', registerGreenScreen],
    ['photokey', registerPhotokey],
    ['loop', registerLoop],
    ['concat', registerConcat],
    ['random', registerRandom],
    ['random-audio', registerRandomAudio],
    ['downloader', registerDownloader]
  ]
  for (const [name, register] of all) {
    try {
      register(ctx)
    } catch (e) {
      console.error(`Đăng ký module ${name} lỗi:`, e)
    }
  }
  return { updater }
}
