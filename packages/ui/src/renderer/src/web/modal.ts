import { h, reactive, type Component } from 'vue'
import { ElDialog } from 'element-plus'

export interface ModalOptions {
  title?: string
  width?: string
  props?: Record<string, unknown>
  component: Component
  /**
   * The component is one of the desktop pages, which assume they own a whole
   * window: their root fills the parent box (100% x 100%) and scrolls
   * internally, so the dialog body has to be given a window-like height.
   */
  page?: boolean
}

export interface ModalHandle {
  id: number
  close: () => void
  onClosed: (handler: () => void) => void
}

interface ModalEntry {
  id: number
  options: ModalOptions
  closedHandlers: Array<() => void>
}

export const MODAL_CLOSE_EVENT = 'ggr:modal-close-requested'

export const modalStack = reactive<ModalEntry[]>([])
let nextModalId = 1

/**
 * Pages rendered in a dialog close themselves with `window.close()`. In a tab
 * that would destroy the session, so signal the owning modal instead.
 */
export function patchWindowClose() {
  window.close = () => {
    window.dispatchEvent(new Event(MODAL_CLOSE_EVENT))
  }
}

export function openWebModal(options: ModalOptions): ModalHandle {
  const entry: ModalEntry = { id: nextModalId++, options, closedHandlers: [] }
  modalStack.push(entry)
  return {
    id: entry.id,
    close: () => closeWebModal(entry.id),
    onClosed: (handler) => {
      entry.closedHandlers.push(handler)
    }
  }
}

export function closeWebModal(id?: number) {
  const index = id === undefined ? modalStack.length - 1 : modalStack.findIndex((it) => it.id === id)
  if (index < 0) {
    return
  }
  const [entry] = modalStack.splice(index, 1)
  for (const handler of entry.closedHandlers) {
    try {
      handler()
    } catch (error) {
      console.error('[web-ui] modal close handler failed', error)
    }
  }
}

export function closeAllWebModals() {
  while (modalStack.length) {
    closeWebModal()
  }
}

/** Renders the modal stack once at the app root. */
export const WebModalHost = {
  name: 'WebModalHost',
  setup() {
    return () =>
      h(
        'div',
        { class: 'web-modal-host' },
        modalStack.map((entry) =>
          h(
            ElDialog,
            {
              key: entry.id,
              class: entry.options.page ? 'ggr-web-page-modal' : '',
              modelValue: true,
              title: entry.options.title,
              width: entry.options.width ?? '720px',
              appendToBody: true,
              destroyOnClose: true,
              closeOnClickModal: false,
              'onUpdate:modelValue': (value: boolean) => {
                if (!value) {
                  closeWebModal(entry.id)
                }
              }
            },
            {
              default: () =>
                h(entry.options.component as Component, {
                  ...(entry.options.props ?? {})
                })
            }
          )
        )
      )
  }
}
