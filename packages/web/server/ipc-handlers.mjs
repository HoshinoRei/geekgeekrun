import fs from 'node:fs'
import path from 'node:path'
import {
  configFileNameList,
  ensureConfigFileExist,
  ensureStorageFileExist,
  readConfigFile,
  readStorageFile,
  storageFilePath,
  writeConfigFile,
  writeStorageFile
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
const FIRST_LAUNCH_FLAG_FILE = 'ui-first-launch-notice-flag'
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+$/

const getFirstLaunchFlagPath = () => path.join(storageFilePath, FIRST_LAUNCH_FLAG_FILE)

export function isFirstLaunchNoticeApproved() {
  return fs.existsSync(getFirstLaunchFlagPath())
}

function createFirstLaunchNoticeFlag() {
  ensureStorageFileExist()
  fs.writeFileSync(getFirstLaunchFlagPath(), `web-${Date.now()}`)
}

function loadLlmBridge() {
  return import('../web-dist/llm-bridge.cjs')
}

function resolveStorageFileName(fileName) {
  if (typeof fileName !== 'string' || !SAFE_FILE_NAME.test(fileName)) {
    throw new Error(`INVALID_FILE_NAME: ${fileName}`)
  }
  return fileName
}

export function createIpcHandlers({ db, workerManager, loginSession, browserInfo, log = console }) {
  async function saveConfigFileFromUi(payloadString) {
    const payload = JSON.parse(payloadString)
    ensureConfigFileExist()
    const writes = []

    const dingtalkConfig = readConfigFile('dingtalk.json')
    if (Object.hasOwn(payload, 'dingtalkRobotAccessToken')) {
      dingtalkConfig.groupRobotAccessToken = payload.dingtalkRobotAccessToken
    }
    writes.push(writeConfigFile('dingtalk.json', dingtalkConfig))

    const bossConfig = readConfigFile('boss.json')
    if (Object.hasOwn(payload, 'anyCombineRecommendJobFilter')) {
      bossConfig.anyCombineRecommendJobFilter = payload.anyCombineRecommendJobFilter
    }
    delete bossConfig.expectJobRegExpStr
    const bossFields = [
      'expectJobNameRegExpStr',
      'expectJobTypeRegExpStr',
      'expectJobDescRegExpStr',
      'jobNotMatchStrategy',
      'markAsNotActiveSelectedTimeRange',
      'jobNotActiveStrategy',
      'autoReminder',
      'expectCityList',
      'expectCityNotMatchStrategy',
      'strategyScopeOptionWhenMarkJobCityNotMatch',
      'expectSalaryCalculateWay',
      'expectSalaryNotMatchStrategy',
      'strategyScopeOptionWhenMarkSalaryNotMatch',
      'expectSalaryLow',
      'expectSalaryHigh',
      'expectWorkExpList',
      'expectWorkExpNotMatchStrategy',
      'strategyScopeOptionWhenMarkJobWorkExpNotMatch',
      'jobDetailRegExpMatchLogic',
      'isSkipEmptyConditionForCombineRecommendJobFilter',
      'jobSourceList',
      'combineRecommendJobFilterType',
      'staticCombineRecommendJobFilterConditions',
      'isSageTimeEnabled',
      'sageTimeOpTimes',
      'sageTimePauseMinute',
      'blockCompanyNameRegExpStr',
      'blockCompanyNameRegMatchStrategy',
      'fieldsForUseCommonConfig'
    ]
    for (const field of bossFields) {
      if (Object.hasOwn(payload, field)) {
        bossConfig[field] = payload[field]
      }
    }
    writes.push(writeConfigFile('boss.json', bossConfig))

    if (Object.hasOwn(payload, 'expectCompanies')) {
      writes.push(
        writeConfigFile('target-company-list.json', payload.expectCompanies?.split(',') ?? [])
      )
    }
    return Promise.all(writes)
  }

  function fetchConfigFileContent() {
    ensureConfigFileExist()
    return {
      config: Object.fromEntries(configFileNameList.map((fileName) => [fileName, readConfigFile(fileName)]))
    }
  }

  async function runWorker(workerId) {
    const existing = workerManager.get(workerId)
    if (existing) {
      return { runRecordId: existing.runRecordId, isAlreadyRunning: true }
    }
    const runRecord = await db.call('saveAndGetCurrentRunRecord')
    workerManager.start(workerId, { runRecordId: runRecord.id })
    return { runRecordId: runRecord.id }
  }

  const invokeHandlers = {
    'ping': () => 'pong',
    'fetch-config-file-content': fetchConfigFileContent,
    'save-config-file-from-ui': ([payload]) => saveConfigFileFromUi(payload),
    'read-storage-file': ([payload]) =>
      readStorageFile(resolveStorageFileName(payload?.fileName)),
    'write-storage-file': ([payload]) =>
      writeStorageFile(
        resolveStorageFileName(payload?.fileName),
        typeof payload?.data === 'string' ? JSON.parse(payload.data) : payload?.data
      ),
    'check-boss-zhipin-cookie-file': async () => {
      const { checkCookieListFormat } = await loadLlmBridge()
      return checkCookieListFormat(readStorageFile('boss-cookies.json'))
    },
    'get-os-platform': () => process.platform,
    'get-task-manager-list': () => ({ workers: workerManager.list() }),
    'run-geek-auto-start-chat-with-boss': () => runWorker('geekAutoStartWithBossMain'),
    'run-read-no-reply-auto-reminder': () => runWorker('readNoReplyAutoReminderMain'),
    'stop-geek-auto-start-chat-with-boss': async () => {
      workerManager.broadcastToClients('geek-auto-start-chat-with-boss-stopping', null)
      await workerManager.stop('geekAutoStartWithBossMain')
      workerManager.broadcastToClients('geek-auto-start-chat-with-boss-stopped', null)
    },
    'stop-read-no-reply-auto-reminder': async () => {
      workerManager.broadcastToClients('read-no-reply-auto-reminder-stopping', null)
      await workerManager.stop('readNoReplyAutoReminderMain')
      workerManager.broadcastToClients('read-no-reply-auto-reminder-stopped', null)
    },
    'stop-task': ([workerId]) => workerManager.stop(workerId),
    'get-auto-start-chat-record': ([payload]) => db.call('getAutoStartChatRecord', payload),
    'get-mark-as-not-suit-record': ([payload]) => db.call('getMarkAsNotSuitRecord', payload),
    'get-job-library': ([payload]) => db.call('getJobLibrary', payload),
    'get-boss-library': ([payload]) => db.call('getBossLibrary', payload),
    'get-company-library': ([payload]) => db.call('getCompanyLibrary', payload),
    'get-job-history-by-encrypt-id': ([encryptJobId]) =>
      db.call('getJobHistoryByEncryptId', { encryptJobId }),
    'save-llm-config': ([config]) => writeConfigFile('llm.json', config),
    'get-llm-config-for-test': () => readConfigFile('llm.json'),
    'fetch-resume-content': () => readConfigFile('resumes.json')?.[0]?.content ?? null,
    'save-resume-content': ([content]) =>
      writeConfigFile('resumes.json', [
        { name: '默认简历', updateTime: Date.now(), content }
      ]),
    'check-is-resume-content-valid': async () => {
      const { checkIsResumeContentValid } = await loadLlmBridge()
      return checkIsResumeContentValid(readConfigFile('resumes.json')?.[0])
    },
    'resume-content-enough-detect': async () => {
      const { resumeContentEnoughDetect } = await loadLlmBridge()
      return resumeContentEnoughDetect(readConfigFile('resumes.json')?.[0])
    },
    'check-if-llm-config-list-valid': () => {
      const llmConfigList = readConfigFile('llm.json')
      if (!Array.isArray(llmConfigList) || !llmConfigList?.length) {
        throw new Error('CANNOT_FIND_VALID_CONFIG')
      }
      if (llmConfigList.some((it) => !/^http(s)?:\/\//.test(it.providerCompleteApiUrl))) {
        throw new Error('CANNOT_FIND_VALID_CONFIG')
      }
      if (llmConfigList.length > 1 && !llmConfigList.find((it) => it.enabled)) {
        throw new Error('CANNOT_FIND_VALID_CONFIG')
      }
    },
    'check-if-auto-remind-prompt-valid': async ([{ type }]) => {
      const { getValidTemplate } = await loadLlmBridge()
      await getValidTemplate({ type })
      return true
    },
    'overwrite-auto-remind-prompt-with-default': async ([{ type }]) => {
      const { writeDefaultAutoRemindPrompt } = await loadLlmBridge()
      await writeDefaultAutoRemindPrompt({ type })
      return true
    },
    'request-llm-for-test': async ([payload]) => {
      const { requestNewMessageContent, RequestSceneEnum } = await loadLlmBridge()
      return requestNewMessageContent(payload.messageList, {
        requestScene: RequestSceneEnum.testing,
        llmConfigIdForPick: payload.llmConfigIdForPick ?? null
      })
    },
    'save-common-job-condition-config': ([config]) =>
      writeConfigFile('common-job-condition-config.json', config),
    'pre-enter-setting-ui': () => ({
      pendingAgreement: !isFirstLaunchNoticeApproved()
    }),
    'check-update': () => null,
    'get-any-available-puppeteer-executable': () => browserInfo,
    'get-last-used-and-available-browser': () => browserInfo,
    'save-last-used-and-available-browser-info': () => null,
    'check-executable-file': ([filePath]) => {
      if (!filePath?.trim()) {
        return { message: '文件名无效' }
      }
      if (!fs.existsSync(filePath)) {
        return { message: '文件不存在' }
      }
      return null
    },
    'choose-file': () => {
      throw new Error('WEB_MODE_FILE_CHOOSER_NOT_SUPPORTED')
    },
    'download-browser-with-downloader': () => {
      if (!browserInfo) {
        throw new Error('NO_BROWSER_AVAILABLE')
      }
      return browserInfo.executablePath
    },
    'setup-dependencies': () => {
      if (!browserInfo) {
        throw new Error('NO_BROWSER_AVAILABLE')
      }
      return browserInfo.executablePath
    },
    'open-site-with-boss-cookie': () => null,
    'config-with-browser-assistant': () => {
      throw new Error('USE_WEB_CONFIG_MODAL')
    },
    'login-with-cookie-assistant': () => {
      throw new Error('USE_WEB_LOGIN_MODAL')
    },
    'common-job-condition-config': () => {
      throw new Error('USE_WEB_CONFIG_MODAL')
    },
    'exit-app-immediately': () => null
  }

  const sendHandlers = {
    'first-launch-notice-approve': () => createFirstLaunchNoticeFlag(),
    'launch-bosszhipin-login-page-with-preload-extension': () => loginSession.start(),
    'kill-bosszhipin-login-page-with-preload-extension': () => loginSession.cancel(),
    'gtag': () => undefined,
    'open-external-link': () => undefined,
    'send-feed-back-to-github-issue': () => undefined,
    'update-window-size': () => undefined,
    'no-reply-reminder-prompt-edit': () => undefined,
    'cookie-saved': () => undefined,
    'browser-config-saved': () => undefined,
    'browser-download-done': () => undefined,
    'common-job-condition-config-done': () => undefined,
    'close-llm-config': () => undefined,
    'close-resume-editor': () => undefined,
    'close-read-no-reply-reminder-llm-mock-window': () => undefined,
    'test-llm-config-effect': () => undefined,
    'worker-exited': () => undefined
  }

  async function invoke(channel, args = []) {
    const handler = invokeHandlers[channel]
    if (!handler) {
      throw new Error(`IPC channel not available in web mode: ${channel}`)
    }
    return handler(args)
  }

  async function send(channel, args = []) {
    const handler = sendHandlers[channel]
    if (!handler) {
      log.log(`[ipc] unhandled send: ${channel}`)
      return
    }
    try {
      await handler(args)
    } catch (error) {
      log.error(`[ipc] send ${channel} failed`, error)
    }
  }

  return { invoke, send }
}

export async function readPromptFile(type) {
  const { getValidTemplate, defaultPromptMap } = await loadLlmBridge()
  if (!defaultPromptMap[type]) {
    throw new Error('INVALID_PROMPT_TYPE')
  }
  return {
    fileName: defaultPromptMap[type].fileName,
    content: await getValidTemplate({ type })
  }
}

export async function writePromptFile(type, content) {
  const { defaultPromptMap } = await loadLlmBridge()
  const fileName = defaultPromptMap[type]?.fileName
  if (!fileName) {
    throw new Error('INVALID_PROMPT_TYPE')
  }
  await writeStorageFile(fileName, content, { isJson: false })
}

