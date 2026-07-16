import { test, expect, type Page } from '@playwright/test'

// Worker 内存回收：池状态可见 + 手动释放。
// 无需真实模型——页面挂载时即按并发数建 idle worker（默认并发 1 → 1 个 idle）。
// 首次访问无已下载模型会弹引导对话框（拦截点击），故 beforeEach 先关闭。

async function dismissOnboarding(page: Page): Promise<void> {
  const onboard = page.getByText('欢迎使用 voicetxt')
  await onboard.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  if (await onboard.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await onboard.waitFor({ state: 'hidden', timeout: 3000 })
  }
}

const badge = (page: Page) => page.getByTestId('worker-pool-badge')
const releaseBtn = (page: Page) => page.getByRole('button', { name: '释放内存' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.locator('header').waitFor()
  await dismissOnboarding(page)
})

test('挂载即有 1 个 idle worker（Worker 0/1）', async ({ page }) => {
  await expect(badge(page)).toHaveText('Worker 0/1')
})

test('点释放内存回收 idle worker（Worker 0/0）', async ({ page }) => {
  await expect(badge(page)).toHaveText('Worker 0/1')
  await releaseBtn(page).click()
  await expect(badge(page)).toHaveText('Worker 0/0')
  await expect(page.getByText(/已释放 1 个空闲 worker/)).toBeVisible()
})

test('并发调到 2 后释放回收多个 worker', async ({ page }) => {
  await page.getByRole('combobox', { name: '并发数' }).click()
  await page.getByRole('option', { name: '2', exact: true }).click()
  await expect(badge(page)).toHaveText('Worker 0/2')
  await releaseBtn(page).click()
  await expect(badge(page)).toHaveText('Worker 0/0')
})

test('无 idle 时释放按钮禁用', async ({ page }) => {
  await releaseBtn(page).click()
  await expect(badge(page)).toHaveText('Worker 0/0')
  await expect(releaseBtn(page)).toBeDisabled()
})
