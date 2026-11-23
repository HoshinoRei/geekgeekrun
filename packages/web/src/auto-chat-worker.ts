import { waitForProcessHandShakeAndRunAutoChat } from '../../ui/src/main/flow/GEEK_AUTO_START_CHAT_WITH_BOSS_MAIN/index'

process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') {
    return
  }
  console.error(err)
  process.exit(1)
})
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err)
})

waitForProcessHandShakeAndRunAutoChat()