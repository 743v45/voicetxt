// 端到端诊断版：监听浏览器 console + 轮询队列状态，定位识别卡住/失败原因。
// 用持久 profile 复用模型缓存。用法: node integration-tests/verify-e2e.mjs
import { chromium } from '@playwright/test'
import path from 'node:path'

const URL = process.env.URL || 'http://localhost:4173'
// 默认用仓库内 fixture(jfk.wav)；也可传任意音频: node verify-e2e.mjs <audio-path>
const AUDIO = path.resolve(process.argv[2] || 'integration-tests/fixtures/jfk.wav')
const PROFILE = '/tmp/voicetxt-pw-profile'

const browser = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = await browser.newPage()
page.setDefaultTimeout(600000)

// 抓浏览器/worker 内的日志与报错（transformers.js 的 warn/error 会在这里）
page.on('console', (msg) => {
  const t = msg.text()
  if (msg.type() === 'error' || /error|fail|warn|whisper|onnx|device|dtype/i.test(t)) {
    console.log(`[browser ${msg.type()}]`, t.slice(0, 400))
  }
})
page.on('pageerror', (err) => console.log('[pageerror]', err.message))

const log = (s) => console.log(`[e2e] ${s}`)

try {
  log(`打开 ${URL}`)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })

  // 引导（若已缓存模型，可能不弹）
  const hasOnboard = await page
    .getByText('欢迎使用 voicetxt')
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false)
  if (hasOnboard) {
    log('引导出现，下载 base …')
    await page.getByRole('button', { name: /下载并开始/ }).click()
    await page.getByText('欢迎使用 voicetxt').waitFor({ state: 'hidden', timeout: 600000 })
    log('模型就绪')
  } else {
    log('未弹引导（模型已缓存）')
  }

  // 清空残留的旧任务（持久库里可能留有历史 error 任务，避免干扰判断）
  const clearBtn = page.getByRole('button', { name: /清空/ })
  if (await clearBtn.isEnabled().catch(() => false)) {
    await clearBtn.click()
    log('清空旧任务')
    await page.waitForTimeout(800)
  }

  log('上传音频…')
  await page.setInputFiles('input[type="file"]', AUDIO)
  await page.getByText('已加入队列').waitFor({ timeout: 30000 })

  log('轮询队列状态（最多 5 分钟）…')
  const start = Date.now()
  let last = ''
  let outcome = 'timeout'
  while (Date.now() - start < 300000) {
    const mainText = await page.locator('main').innerText().catch(() => '')
    const queuePart = mainText.split('处理队列')[1] ?? ''
    if (queuePart !== last) {
      last = queuePart
      console.log('[queue]', queuePart.replace(/\n+/g, ' | ').slice(0, 600))
    }
    if (/查看结果/.test(queuePart)) { outcome = 'done'; break }
    if (/重试/.test(queuePart) && /错误/.test(queuePart)) { outcome = 'error'; break }
    await page.waitForTimeout(5000)
  }

  if (outcome === 'done') {
    log('完成，打开结果')
    await page.getByRole('button', { name: /查看结果/ }).first().click()
    await page.locator('pre').first().waitFor({ timeout: 30000 })
    const text = (await page.locator('pre').first().innerText()).trim()
    log('=== RESULT ===')
    console.log(text)
    // 通用判断：非空且无明显乱码（单字符连发 / 同词重复 3 次以上）
    const looksGarbage = /(.)\1{6,}|(\b\w+\b)\s+\2\s+\2/i.test(text)
    const looksOk = text.length > 5 && !looksGarbage
    log(`looksReasonable=${looksOk}`)
    await browser.close()
    process.exit(looksOk ? 0 : 1)
  } else {
    log(`结局: ${outcome}，抓页面文本`)
    const mainText = await page.locator('main').innerText().catch(() => '')
    console.log('[final-main]', mainText.replace(/\n+/g, ' | ').slice(0, 1000))
    await browser.close()
    process.exit(outcome === 'error' ? 2 : 3)
  }
} catch (e) {
  log(`异常: ${e?.message || e}`)
  await browser.close()
  process.exit(4)
}
