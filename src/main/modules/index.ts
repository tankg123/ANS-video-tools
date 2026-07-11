import type { ModuleContext } from '../module-context'
import registerRender from './render'
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
import registerUpdater from './updater'

/** Đăng ký toàn bộ module (spec mục 3.1). */
export function registerAllModules(ctx: ModuleContext): void {
  const all: Array<[string, (c: ModuleContext) => void]> = [
    ['render', registerRender],
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
    ['downloader', registerDownloader],
    ['updater', registerUpdater]
  ]
  for (const [name, register] of all) {
    try {
      register(ctx)
    } catch (e) {
      console.error(`Đăng ký module ${name} lỗi:`, e)
    }
  }
}
