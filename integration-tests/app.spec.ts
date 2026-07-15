import { test, expect, type Page } from '@playwright/test'

// 基础冒烟测试：验证页面结构、输入区、模型选择器、模型管理、结果占位。
// 首次访问无已下载模型会自动弹引导对话框（modal，会拦截点击），
// 故 beforeEach 先关闭它再测主界面。不触发真实模型下载/识别。

async function dismissOnboarding(page: Page): Promise<void> {
  const onboard = page.getByText('欢迎使用 voicetxt')
  await onboard.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  if (await onboard.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await onboard.waitFor({ state: 'hidden', timeout: 3000 })
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.locator('header').waitFor()
  await dismissOnboarding(page)
})

test('首页显示标题与输入区', async ({ page }) => {
  await expect(page.locator('header')).toBeVisible()
  await expect(page.getByText('voicetxt').first()).toBeVisible()
  await expect(page.getByRole('tab', { name: '上传文件' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '实时录音' })).toBeVisible()
})

test('模型选择器列出四档', async ({ page }) => {
  await page.getByRole('combobox').first().click()
  for (const id of ['tiny', 'base', 'small', 'medium']) {
    await expect(page.getByRole('option', { name: new RegExp(id) })).toBeVisible()
  }
})

test('打开模型管理对话框并列出档位', async ({ page }) => {
  await page.getByRole('button', { name: /模型管理/ }).click()
  await expect(page.getByRole('dialog').getByText('模型管理')).toBeVisible()
  for (const id of ['tiny', 'base', 'small', 'medium']) {
    await expect(page.getByRole('dialog').getByText(id, { exact: false }).first()).toBeVisible()
  }
})

test('结果区显示占位提示', async ({ page }) => {
  await expect(page.getByText('识别结果将显示在这里')).toBeVisible()
})
