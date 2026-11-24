import { createApp, h } from 'vue'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { createPinia } from 'pinia'
import 'normalize.css'
import '@renderer/style/public.scss'
import 'element-plus/dist/index.css'
import 'virtual:uno.css'
import 'animate.css'
import './modal.scss'
import './install-electron'
import './intercept'
import App from '../App.vue'
import router from '../router'
import { WebModalHost } from './modal'
import { WebLoginModalHost } from './login-modal'
import { installInterceptors } from './intercept'
import { ipcRenderer, webApi } from './ipc'

installInterceptors()
window.webApi = webApi

// When GEEKGEEKRUN_AUTH_TOKEN is set, ask for it once and store it as a cookie.
let authPromptShown = false
window.addEventListener('ggr:unauthorized', () => {
  if (authPromptShown) {
    return
  }
  authPromptShown = true
  ElMessageBox.prompt('请输入部署时配置的访问令牌', '需要访问令牌', {
    confirmButtonText: '进入',
    cancelButtonText: '取消',
    inputType: 'password',
    closeOnClickModal: false
  })
    .then(async ({ value }) => {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'x-auth-token': value }
      })
      if (!response.ok) {
        throw new Error('访问令牌无效')
      }
      window.location.reload()
    })
    .catch((error) => {
      authPromptShown = false
      if (error !== 'cancel' && error !== 'close') {
        ElMessage.error(error instanceof Error ? error.message : String(error))
      }
    })
})

const Root = {
  name: 'WebRoot',
  render() {
    return h('div', { class: 'web-root' }, [h(App), h(WebModalHost), h(WebLoginModalHost)])
  }
}

const pinia = createPinia()
createApp(Root).use(pinia).use(router).use(ElementPlus).mount('#app')

ipcRenderer.on('toast-message', (_, payload) => {
  if (typeof payload === 'string') {
    ElMessage(payload)
  }
})

ipcRenderer.on('web-shutting-down', () => {
  ElMessage.warning('服务正在关闭，请稍后刷新页面')
})