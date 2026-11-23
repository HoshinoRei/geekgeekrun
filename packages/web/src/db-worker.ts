import 'reflect-metadata'
import { parentPort } from 'node:worker_threads'
import { initDb } from '@geekgeekrun/sqlite-plugin'
import type { DataSource } from 'typeorm'
import { getPublicDbFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { VChatStartupLog } from '@geekgeekrun/sqlite-plugin/dist/entity/VChatStartupLog'
import { VJobLibrary } from '@geekgeekrun/sqlite-plugin/dist/entity/VJobLibrary'
import { VCompanyLibrary } from '@geekgeekrun/sqlite-plugin/dist/entity/VCompanyLibrary'
import { VBossLibrary } from '@geekgeekrun/sqlite-plugin/dist/entity/VBossLibrary'
import { VMarkAsNotSuitLog } from '@geekgeekrun/sqlite-plugin/dist/entity/VMarkAsNotSuitLog'
import { JobInfoChangeLog } from '@geekgeekrun/sqlite-plugin/dist/entity/JobInfoChangeLog'
import { AutoStartChatRunRecord } from '@geekgeekrun/sqlite-plugin/dist/entity/AutoStartChatRunRecord'
import { measureExecutionTime } from '../../ui/src/common/utils/performance'
import type { PageReq, PagedRes } from '../../ui/src/common/types/pagination'

const dbInitPromise = initDb(getPublicDbFilePath())
let dataSource: DataSource | null = null

dbInitPromise.then(
  (_dataSource) => {
    dataSource = _dataSource
    attachMessageHandler()
    parentPort?.postMessage({ type: 'DB_INIT_SUCCESS' })
  },
  (error) => {
    parentPort?.postMessage({ type: 'DB_INIT_FAIL', error: String(error) })
    process.exit(1)
  }
)

const payloadHandler = {
  async getAutoStartChatRecord({ pageNo = 1, pageSize = 10 }: Partial<PageReq> = {}) {
    const repository = dataSource!.getRepository(VChatStartupLog)
    const [data, totalItemCount] = await measureExecutionTime(
      repository.findAndCount({
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        order: { date: 'DESC' }
      })
    )
    return { data, pageNo, totalItemCount } satisfies PagedRes<VChatStartupLog>
  },
  async getMarkAsNotSuitRecord({ pageNo = 1, pageSize = 10 }: Partial<PageReq> = {}) {
    const repository = dataSource!.getRepository(VMarkAsNotSuitLog)
    const [data, totalItemCount] = await measureExecutionTime(
      repository.findAndCount({
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        order: { date: 'DESC' }
      })
    )
    return { data, pageNo, totalItemCount } satisfies PagedRes<VMarkAsNotSuitLog>
  },
  async getJobLibrary({ pageNo = 1, pageSize = 10 }: Partial<PageReq> = {}) {
    const repository = dataSource!.getRepository(VJobLibrary)
    const [data, totalItemCount] = await measureExecutionTime(
      repository.findAndCount({
        skip: (pageNo - 1) * pageSize,
        take: pageSize
      })
    )
    return { data, pageNo, totalItemCount } satisfies PagedRes<VJobLibrary>
  },
  async getCompanyLibrary({ pageNo = 1, pageSize = 10 }: Partial<PageReq> = {}) {
    const repository = dataSource!.getRepository(VCompanyLibrary)
    const [data, totalItemCount] = await measureExecutionTime(
      repository.findAndCount({
        skip: (pageNo - 1) * pageSize,
        take: pageSize
      })
    )
    return { data, pageNo, totalItemCount } satisfies PagedRes<VCompanyLibrary>
  },
  async getBossLibrary({ pageNo = 1, pageSize = 10 }: Partial<PageReq> = {}) {
    const repository = dataSource!.getRepository(VBossLibrary)
    const [data, totalItemCount] = await measureExecutionTime(
      repository.findAndCount({
        skip: (pageNo - 1) * pageSize,
        take: pageSize
      })
    )
    return { data, pageNo, totalItemCount } satisfies PagedRes<VBossLibrary>
  },
  async getJobHistoryByEncryptId({ encryptJobId }: { encryptJobId: string }) {
    const repository = dataSource!.getRepository(JobInfoChangeLog)
    return measureExecutionTime(repository.find({ where: { encryptJobId } }))
  },
  async saveAndGetCurrentRunRecord() {
    const record = new AutoStartChatRunRecord()
    record.date = new Date()
    return dataSource!.getRepository(AutoStartChatRunRecord).save(record)
  }
}

async function attachMessageHandler() {
  parentPort?.on('message', async (event: { _uuid: string; type: keyof typeof payloadHandler }) => {
    const { _uuid, type, ...restObj } = event
    try {
      if (!dataSource) {
        await dbInitPromise
      }
      const handler = payloadHandler[type]
      if (!handler) {
        throw new Error(`Unknown DB operation: ${type}`)
      }
      const data = await handler(restObj as never)
      parentPort?.postMessage({ _uuid, data })
    } catch (error) {
      parentPort?.postMessage({
        _uuid,
        data: null,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })
}