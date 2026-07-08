import type { ModuleContext } from '../module-context'
import registerSuperLive from './super-live'
import registerBasicLive from './basic-live'
import registerRender from './render'
import registerUpscale from './upscale'
import registerIntroOutroLogo from './intro-outro-logo'
import registerSplit from './split'
import registerTrim from './trim'
import registerGreenScreen from './green-screen'
import registerLoop from './loop'
import registerConcat from './concat'
import registerDownloader from './downloader'
import registerUpdater from './updater'

/** Đăng ký toàn bộ 11 module (spec mục 3.1). */
export function registerAllModules(ctx: ModuleContext): void {
  const all: Array<[string, (c: ModuleContext) => void]> = [
    ['super-live', registerSuperLive],
    ['basic-live', registerBasicLive],
    ['render', registerRender],
    ['upscale', registerUpscale],
    ['intro-outro-logo', registerIntroOutroLogo],
    ['split', registerSplit],
    ['trim', registerTrim],
    ['green-screen', registerGreenScreen],
    ['loop', registerLoop],
    ['concat', registerConcat],
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
