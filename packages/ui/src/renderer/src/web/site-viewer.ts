import { defineComponent, h, onMounted, onUnmounted, ref } from 'vue'
import { ElButton, ElInput, ElMessage, ElSelect, ElOption } from 'element-plus'

interface SiteSessionStatus {
  status: string
  error?: string
  url?: string | null
  title?: string | null
  hasPage: boolean
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.error) {
    throw new Error(body?.error ?? `HTTP ${response.status}`)
  }
  return body as T
}

const PRESET_PAGES = [
  { label: '推荐职位', url: 'https://www.zhipin.com/web/geek/jobs' },
  { label: '聊天', url: 'https://www.zhipin.com/web/geek/chat' },
  { label: '我的主页', url: 'https://www.zhipin.com/web/geek/myHome' }
]

/**
 * Streams a headless Chromium page into the UI. Replaces the desktop windows
 * opened by "手动逛 BOSS" and detail links.
 */
export const SiteViewer = defineComponent({
  name: 'WebSiteViewer',
  props: {
    initialUrl: {
      type: String,
      default: 'https://www.zhipin.com/web/geek/jobs'
    },
    onClose: {
      type: Function,
      default: undefined
    }
  },
  setup(props) {
    const imageSrc = ref('')
    const status = ref<SiteSessionStatus | null>(null)
    const urlInput = ref(props.initialUrl)
    const typeInput = ref('')
    const loading = ref(false)
    let timer: ReturnType<typeof setInterval> | null = null

    const refreshScreenshot = async () => {
      if (loading.value) {
        return
      }
      loading.value = true
      try {
        const response = await fetch(`/api/site-session/screenshot?t=${Date.now()}`, {
          credentials: 'same-origin'
        })
        if (response.ok) {
          const blob = await response.blob()
          if (imageSrc.value.startsWith('blob:')) {
            URL.revokeObjectURL(imageSrc.value)
          }
          imageSrc.value = URL.createObjectURL(blob)
        }
      } catch {
        // ignore transient capture errors
      } finally {
        loading.value = false
      }
    }

    const refreshStatus = async () => {
      try {
        status.value = await requestJson<SiteSessionStatus>('/api/site-session/status')
        if (status.value.url && document.activeElement !== document.querySelector('.web-site-url input')) {
          urlInput.value = status.value.url
        }
      } catch {
        // ignore
      }
    }

    const open = async (url = urlInput.value) => {
      try {
        const result = await requestJson<SiteSessionStatus>('/api/site-session/open', {
          method: 'POST',
          body: JSON.stringify({ url })
        })
        status.value = result
        if (result.url) {
          urlInput.value = result.url
        }
        await refreshScreenshot()
      } catch (error) {
        ElMessage.error(error instanceof Error ? error.message : String(error))
      }
    }

    const handleImageClick = async (event: MouseEvent) => {
      const target = event.target as HTMLImageElement
      const rect = target.getBoundingClientRect()
      try {
        await requestJson('/api/site-session/click', {
          method: 'POST',
          body: JSON.stringify({
            x: (event.clientX - rect.left) / rect.width,
            y: (event.clientY - rect.top) / rect.height
          })
        })
      } catch (error) {
        ElMessage.error(error instanceof Error ? error.message : String(error))
        return
      }
      setTimeout(() => {
        void refreshScreenshot()
        void refreshStatus()
      }, 600)
    }

    const sendKey = async (key: string) => {
      try {
        await requestJson('/api/site-session/key', {
          method: 'POST',
          body: JSON.stringify({ key })
        })
        setTimeout(refreshScreenshot, 400)
      } catch (error) {
        ElMessage.error(error instanceof Error ? error.message : String(error))
      }
    }

    const sendText = async () => {
      if (!typeInput.value) {
        return
      }
      try {
        await requestJson('/api/site-session/type', {
          method: 'POST',
          body: JSON.stringify({ text: typeInput.value })
        })
        typeInput.value = ''
        setTimeout(refreshScreenshot, 400)
      } catch (error) {
        ElMessage.error(error instanceof Error ? error.message : String(error))
      }
    }

    const saveCookies = async () => {
      try {
        await requestJson('/api/site-session/save-cookies', { method: 'POST' })
        ElMessage.success('当前页面的 Cookie 已保存')
      } catch (error) {
        ElMessage.error(error instanceof Error ? error.message : String(error))
      }
    }

    onMounted(async () => {
      await open(props.initialUrl)
      timer = setInterval(() => {
        void refreshScreenshot()
        void refreshStatus()
      }, 1500)
    })

    onUnmounted(() => {
      if (timer) {
        clearInterval(timer)
      }
      requestJson('/api/site-session/close', { method: 'POST' }).catch(() => undefined)
    })

    return () =>
      h('div', { class: 'web-site-viewer' }, [
        h(
          'div',
          {
            style: {
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              marginBottom: '8px',
              flexWrap: 'wrap'
            }
          },
          [
            h(
              ElButton,
              { size: 'small', onClick: () => sendKey('Alt+Left') },
              () => '← 后退'
            ),
            h(
              ElButton,
              { size: 'small', onClick: () => sendKey('F5') },
              () => '刷新'
            ),
            h(
              ElSelect,
              {
                size: 'small',
                placeholder: '快速进入',
                style: 'width: 120px',
                onChange: (value: string) => open(value)
              },
              () =>
                PRESET_PAGES.map((item) =>
                  h(ElOption, { key: item.url, label: item.label, value: item.url })
                )
            ),
            h(ElInput, {
              modelValue: urlInput.value,
              class: 'web-site-url',
              size: 'small',
              style: 'flex: 1; min-width: 240px',
              'onUpdate:modelValue': (value: string) => {
                urlInput.value = value
              },
              onKeyup: (event: KeyboardEvent) => {
                if (event.key === 'Enter') {
                  void open()
                }
              }
            }),
            h(
              ElButton,
              { size: 'small', type: 'primary', onClick: () => open() },
              () => '打开'
            ),
            h(
              ElButton,
              { size: 'small', type: 'success', onClick: saveCookies },
              () => '保存当前 Cookie'
            )
          ]
        ),
        h(
          'div',
          {
            style: {
              border: '1px solid var(--el-border-color)',
              borderRadius: '6px',
              background: '#f5f5f5',
              minHeight: '200px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden'
            }
          },
          [
            imageSrc.value
              ? h('img', {
                  src: imageSrc.value,
                  style: { width: '100%', display: 'block', cursor: 'crosshair' },
                  onClick: handleImageClick
                })
              : h(
                  'div',
                  { style: { padding: '40px', color: '#999' } },
                  status.value?.error ?? '正在打开页面…'
                )
          ]
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              gap: '8px',
              marginTop: '8px',
              alignItems: 'center'
            }
          },
          [
            h(ElInput, {
              modelValue: typeInput.value,
              size: 'small',
              placeholder: '向页面输入文字（例如聊天内容），回车发送',
              'onUpdate:modelValue': (value: string) => {
                typeInput.value = value
              },
              onKeyup: (event: KeyboardEvent) => {
                if (event.key === 'Enter') {
                  void sendText()
                }
              }
            }),
            h(ElButton, { size: 'small', onClick: sendText }, () => '输入'),
            h(
              ElButton,
              { size: 'small', onClick: () => sendKey('Enter') },
              () => '回车'
            ),
            h(
              ElButton,
              { size: 'small', onClick: () => sendKey('Escape') },
              () => 'Esc'
            )
          ]
        )
      ])
  }
})