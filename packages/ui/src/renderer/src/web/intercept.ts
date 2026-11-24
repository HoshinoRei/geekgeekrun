import { h, defineComponent } from 'vue'
import { ElMessage } from 'element-plus'
import { baseInvoke, baseSend, dispatchLocal, ipcRenderer, webApi } from './ipc'
import { isRecord } from './guards'
import {
  closeWebModal,
  MODAL_CLOSE_EVENT,
  modalStack,
  openWebModal,
  type ModalOptions
} from './modal'
import { openLoginModal } from './login-modal'
import { PromptEditor } from './prompt-editor'
import { SiteViewer } from './site-viewer'
import LlmConfigPage from '@renderer/page/LlmConfig/index.vue'
import ResumeEditorPage from '@renderer/page/ResumeEditor/index.vue'
import CommonJobConditionConfigPage from '@renderer/page/CommonJobConditionConfig/index.vue'
import ReadNoReplyReminderLlmMockPage from '@renderer/page/ReadNoReplyReminderLlmMock/index.vue'
import FirstRunReadmePage from '@renderer/page/FirstRunReadme/index.vue'


interface ModalFlowOptions extends ModalOptions {
  title: string
}

/**
 * Opens a page in a dialog and settles when the page emits one of the
 * completion channels or the dialog is dismissed.
 */
function openModalFlow(
  options: ModalFlowOptions,
  completion: string[],
  forwarding: Array<{ channel: string; handler: () => void }> = []
): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const modal = openWebModal(options)
  let settled = false
  const offs: Array<() => void> = []
  const cleanup = () => {
    offs.forEach((off) => off())
    offs.length = 0
  }
  const settle = (result: 'resolve' | 'reject') => {
    if (settled) {
      return
    }
    settled = true
    cleanup()
    closeWebModal(modal.id)
    if (result === 'resolve') {
      resolve()
    } else {
      reject(new Error('USER_CANCELLED'))
    }
  }
  for (const channel of completion) {
    offs.push(ipcRenderer.on(channel, () => settle('resolve')))
  }
  for (const item of forwarding) {
    offs.push(ipcRenderer.on(item.channel, item.handler))
  }
  window.addEventListener(
    MODAL_CLOSE_EVENT,
    () => {
      // The dialog that requested it is the top of the stack.
      if (modalStack[modalStack.length - 1]?.id === modal.id) {
        settle('reject')
      }
    },
    { once: true }
  )
  modal.onClosed(() => settle('reject'))
  return promise
}

function getModalByTitlePart(part: string) {
  return [...modalStack].reverse().find((entry) => entry.options.title?.includes(part))
}

const interceptedInvokes: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  'pre-enter-setting-ui': async () => {
    const env = await webApi.env()
    if (!env.remoteBrowserConfigured && !env.browserExecutablePath) {
      ElMessage.error(
        '未配置外部浏览器（GEEKGEEKRUN_BROWSER_URL / GEEKGEEKRUN_BROWSER_WS_ENDPOINT），且容器内未找到 Chromium'
      )
    }
    const result = await baseInvoke('pre-enter-setting-ui')
    if (isRecord(result) && result.pendingAgreement) {
      await openModalFlow(
        { title: '初次使用必读', width: '960px', component: FirstRunReadmePage, page: true },
        ['first-launch-notice-approve']
      ).catch(() => undefined)
    }
    return result
  },
  'llm-config': () =>
    openModalFlow(
      { title: '大语言模型设置', width: '640px', component: LlmConfigPage, page: true },
      ['save-llm-config']
    ),
  'resume-edit': () =>
    openModalFlow({ title: '简历编辑', width: '1000px', component: ResumeEditorPage, page: true }, [
      'save-resume-content'
    ]),
  'common-job-condition-config': async () => {
    await openModalFlow(
      {
        title: '公共职位筛选条件',
        width: '1024px',
        component: CommonJobConditionConfigPage,
        page: true
      },
      ['common-job-condition-config-done']
    )
    const config = await baseInvoke('fetch-config-file-content')
    if (isRecord(config) && isRecord(config.config)) {
      dispatchLocal('common-job-condition-config-updated', {
        config: config.config['common-job-condition-config.json']
      })
    }
  },
  'login-with-cookie-assistant': () => openLoginModal(),
  'config-with-browser-assistant': async () => {
    const env = await webApi.env()
    if (env.remoteBrowserConfigured) {
      ElMessage.success('当前使用外部浏览器（远程 CDP），请在部署配置中调整连接地址')
      return true
    }
    if (!env.browserExecutablePath) {
      throw new Error('容器内未找到可用的浏览器')
    }
    ElMessage.success(`当前容器浏览器：${env.browserExecutablePath}`)
    return true
  },
  'open-site-with-boss-cookie': (payload) => {
    const url =
      (isRecord(payload) && typeof payload.url === 'string' && payload.url) ||
      'https://www.zhipin.com/web/geek/jobs'
    // Desktop resolves once the window is created; the dialog is not awaited.
    openModalFlow(
      {
        title: 'BOSS 直聘（容器内浏览器）',
        width: '1200px',
        component: SiteViewer,
        props: { initialUrl: url }
      },
      []
    ).catch(() => undefined)
    return Promise.resolve(null)
  }
}

const dispatchedSends: Record<string, true> = {
  'first-launch-notice-approve': true,
  'common-job-condition-config-done': true,
  'cookie-saved': true
}

const interceptedSends: Record<string, (...args: unknown[]) => Promise<unknown> | unknown> = {
  'first-launch-notice-approve': async () => {
    dispatchLocal('first-launch-notice-approve', null)
    return baseSend('first-launch-notice-approve')
  },
  'common-job-condition-config-done': () => {
    dispatchLocal('common-job-condition-config-done', null)
    return baseSend('common-job-condition-config-done')
  },
  'no-reply-reminder-prompt-edit': (payload) => {
    const type = isRecord(payload) && payload.type === 'open' ? 'open' : 'rechat'
    const modal = openWebModal({
      title: type === 'open' ? '开场白提示词' : '已读不回复聊提示词',
      width: '860px',
      component: PromptEditor,
      props: {
        type,
        onClose: () => closeWebModal(modal.id)
      }
    })
    return undefined
  },
  'test-llm-config-effect': (payload) => {
    const autoReminder = isRecord(payload) && isRecord(payload.autoReminderConfig)
      ? payload.autoReminderConfig
      : {}
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(autoReminder)) {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value))
      }
    }
    // The mock page reads configuration from `location.search`, mirroring the
    // desktop window which appends the config as query params.
    const previousUrl = window.location.href
    window.history.replaceState(null, '', `${window.location.pathname}?${searchParams}`)
    const modal = openWebModal({
      title: '已读不回自动复聊 大语言模型测试',
      width: '640px',
      component: ReadNoReplyReminderLlmMockPage,
      page: true
    })
    queueMicrotask(() => window.history.replaceState(null, '', previousUrl))
    modal.onClosed(() => undefined)
    return undefined
  }
}

const modalCloseByChannel: Record<string, string> = {
  'close-llm-config': '大语言模型',
  'close-resume-editor': '简历'
}

export function installInterceptors() {
  ipcRenderer.invoke = async (channel, ...args) => {
    if (channel in interceptedInvokes) {
      return interceptedInvokes[channel](...args)
    }
    const result = await baseInvoke(channel, ...args)
    if (channel === 'save-llm-config' || channel === 'save-resume-content') {
      dispatchLocal(channel, null)
    }
    return result
  }

  ipcRenderer.send = (channel, ...args) => {
    if (dispatchedSends[channel]) {
      dispatchLocal(channel, null)
      return baseSend(channel, ...args)
    }
    const titlePart = modalCloseByChannel[channel]
    if (titlePart) {
      const target = getModalByTitlePart(titlePart)
      if (target) {
        closeWebModal(target.id)
      }
      return Promise.resolve()
    }
    if (channel === 'close-read-no-reply-reminder-llm-mock-window') {
      const target = modalStack[modalStack.length - 1]
      if (target) {
        closeWebModal(target.id)
      }
      return Promise.resolve()
    }
    if (channel in interceptedSends) {
      return Promise.resolve(interceptedSends[channel](...args))
    }
    return baseSend(channel, ...args)
  }

  ipcRenderer.on('web-login-required', () => {
    openLoginModal().catch(() => undefined)
  })
  ipcRenderer.on('toast-message', (_, payload) => {
    if (typeof payload === 'string') {
      ElMessage({ message: payload, grouping: true })
    }
  })
}

/** Extra roots rendered next to the desktop app shell. */
export const WebHosts = defineComponent({
  name: 'WebHosts',
  setup() {
    return () => h('div', { class: 'web-hosts' })
  }
})
