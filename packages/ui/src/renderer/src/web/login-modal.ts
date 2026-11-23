import { h, defineComponent, reactive, watch } from 'vue'
import { ElButton, ElDialog, ElAlert, ElMessage } from 'element-plus'
import { webApi } from './ipc'

export const loginState = reactive({
  open: false,
  status: 'idle' as 'idle' | 'starting' | 'waiting' | 'success' | 'error' | 'canceled',
  error: '',
  imageSrc: '',
  loading: false,
  remoteBrowser: false
})

let pollTimer: ReturnType<typeof setInterval> | null = null

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function refreshScreenshot() {
  if (loginState.loading) {
    return
  }
  loginState.loading = true
  try {
    const response = await fetch(`/api/login-session/screenshot?t=${Date.now()}`, {
      credentials: 'same-origin'
    })
    if (!response.ok) {
      return
    }
    const blob = await response.blob()
    if (loginState.imageSrc.startsWith('blob:')) {
      URL.revokeObjectURL(loginState.imageSrc)
    }
    loginState.imageSrc = URL.createObjectURL(blob)
  } catch {
    // page may still be loading
  } finally {
    loginState.loading = false
  }
}

/**
 * Reads login-session state until the server saves cookies or reports a
 * failure. The renderer polls rather than nesting the SSE stream.
 */
export async function waitForLoginResult(): Promise<boolean> {
  const { promise, resolve, reject } = Promise.withResolvers<boolean>()
  stopPolling()
  const tick = async () => {
    try {
      const status = await webApi.loginSession.status()
      loginState.status = status.status
      loginState.error = status.error ?? ''
      if (status.status === 'waiting' && status.hasPage) {
        await refreshScreenshot()
      }
      if (status.status === 'success') {
        stopPolling()
        ElMessage.success('BOSS 直聘登录成功，登录凭证已保存')
        loginState.open = false
        resolve(true)
      } else if (status.status === 'error') {
        stopPolling()
        reject(new Error(loginState.error || 'LOGIN_FAILED'))
      } else if (status.status === 'canceled') {
        stopPolling()
        loginState.open = false
        reject(new Error('USER_CANCELLED_LOGIN'))
      }
    } catch (error) {
      stopPolling()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  }
  pollTimer = setInterval(tick, 1000)
  void tick()
  return promise
}

export async function openLoginModal(): Promise<boolean> {
  loginState.open = true
  loginState.status = 'starting'
  loginState.error = ''
  const env = await webApi.env().catch(() => null)
  loginState.remoteBrowser = Boolean(env?.remoteBrowserConfigured)
  const status = await webApi.loginSession.start()
  loginState.status = status.status
  loginState.error = status.error ?? ''
  return waitForLoginResult()
}

export async function cancelLoginModal() {
  stopPolling()
  await webApi.loginSession.cancel().catch(() => undefined)
  loginState.open = false
}

watch(
  () => loginState.open,
  (value) => {
    if (!value) {
      stopPolling()
    }
  }
)

const LoginModal = defineComponent({
  name: 'WebLoginModal',
  setup() {
    const handleImageClick = async (event: MouseEvent) => {
      const target = event.target as HTMLImageElement
      const rect = target.getBoundingClientRect()
      const x = (event.clientX - rect.left) / rect.width
      const y = (event.clientY - rect.top) / rect.height
      try {
        await webApi.loginSession.click(x, y)
      } catch (error) {
        ElMessage.error(error instanceof Error ? error.message : String(error))
      }
      setTimeout(refreshScreenshot, 300)
    }

    return () =>
      h(
        ElDialog,
        {
          modelValue: loginState.open,
          title: 'BOSS 登录助手',
          width: '1080px',
          appendToBody: true,
          destroyOnClose: true,
          closeOnClickModal: false,
          'onUpdate:modelValue': (value: boolean) => {
            if (!value) {
              cancelLoginModal()
            }
          }
        },
        {
          default: () =>
            h('div', { class: 'web-login-modal' }, [
              h(
                ElAlert,
                { closable: false, type: 'info', class: 'mb12px' },
                () =>
                  loginState.remoteBrowser
                    ? '已连接外部浏览器：既可以直接在 VNC / 远程桌面中的标签页里操作登录，也可以扫描下方截图中的二维码。登录成功后 Cookie 会自动保存。'
                    : '容器内以无头模式打开 BOSS 直聘登录页。请扫描图中的二维码；出现滑块验证时直接点击图片中的对应位置。登录成功后 Cookie 会自动保存。'
              ),
              loginState.status === 'error'
                ? h(ElAlert, { closable: false, type: 'error', class: 'mb12px' }, () =>
                    loginState.error
                  )
                : null,
              h(
                'div',
                {
                  class: 'web-login-screen',
                  style: {
                    position: 'relative',
                    width: '1000px',
                    maxWidth: '100%',
                    minHeight: '300px',
                    background: '#f5f5f5',
                    border: '1px solid var(--el-border-color)',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }
                },
                [
                  loginState.imageSrc
                    ? h('img', {
                        src: loginState.imageSrc,
                        style: { width: '100%', display: 'block', cursor: 'crosshair' },
                        onClick: handleImageClick
                      })
                    : h(
                        'div',
                        { style: { padding: '40px', color: '#999' } },
                        loginState.status === 'starting'
                          ? '正在启动容器内浏览器…'
                          : loginState.status === 'waiting'
                            ? '正在截取登录页…'
                            : '等待登录会话'
                      )
                ]
              ),
              h(
                'div',
                {
                  style: {
                    marginTop: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }
                },
                [
                  h('span', { style: { color: '#999', fontSize: '12px' } }, '页面每秒自动刷新'),
                  h(
                    ElButton,
                    {
                      type: 'primary',
                      onClick: () => refreshScreenshot()
                    },
                    () => '刷新画面'
                  )
                ]
              )
            ])
        }
      )
  }
})

export const WebLoginModalHost = LoginModal
