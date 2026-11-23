import { defineComponent, h, ref } from 'vue'
import { ElAlert, ElButton, ElInput, ElMessage } from 'element-plus'
import { baseInvoke, webApi } from './ipc'

const PROMPT_LABELS = {
  rechat: '已读不回自动复聊提示词',
  open: '开场白提示词'
}

/**
 * Desktop opens the prompt markdown file in the OS editor. The web UI edits it
 * in a textarea instead.
 */
export const PromptEditor = defineComponent({
  name: 'WebPromptEditor',
  props: {
    type: {
      type: String,
      required: true
    },
    onClose: {
      type: Function,
      default: undefined
    }
  },
  setup(props) {
    const content = ref('')
    const loading = ref(true)
    const saving = ref(false)

    webApi.prompt
      .get(props.type)
      .then((result) => {
        content.value = result?.content ?? ''
      })
      .catch((error) => {
        ElMessage.error(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        loading.value = false
      })

    const save = async () => {
      saving.value = true
      try {
        await webApi.prompt.write(props.type, content.value)
        ElMessage.success('提示词已保存')
        props.onClose?.()
      } catch (error) {
        ElMessage.error(error instanceof Error ? error.message : String(error))
      } finally {
        saving.value = false
      }
    }

    const restoreDefault = async () => {
      try {
        await baseInvoke('overwrite-auto-remind-prompt-with-default', { type: props.type })
        const result = await webApi.prompt.get(props.type)
        content.value = result?.content ?? ''
        ElMessage.success('已恢复默认提示词')
      } catch (error) {
        ElMessage.error(error instanceof Error ? error.message : String(error))
      }
    }

    return () =>
      h('div', { class: 'web-prompt-editor' }, [
        h(
          ElAlert,
          { closable: false, type: 'info', class: 'mb12px' },
          () =>
            `编辑${PROMPT_LABELS[props.type] ?? props.type}。保存后立即用于后续生成，无需重启任务。`
        ),
        h(ElInput, {
          modelValue: content.value,
          type: 'textarea',
          rows: 22,
          'onUpdate:modelValue': (value: string) => {
            content.value = value
          },
          disabled: loading.value,
          style: 'font-family: monospace; font-size: 12px'
        }),
        h(
          'div',
          {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '12px'
            }
          },
          [
            h(ElButton, { onClick: restoreDefault }, () => '恢复默认'),
            h(
              'div',
              null,
              [
                h(ElButton, { onClick: () => props.onClose?.() }, () => '取消'),
                h(
                  ElButton,
                  { type: 'primary', loading: saving.value, onClick: save },
                  () => '保存'
                )
              ]
            )
          ]
        )
      ])
  }
})