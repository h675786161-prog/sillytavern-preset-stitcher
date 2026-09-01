// QA trigger: 2026-09-01 isolated Tavern smoke
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const playwrightEntry = process.env.PLAYWRIGHT_CORE_ENTRY;
if (!playwrightEntry) throw new Error('PLAYWRIGHT_CORE_ENTRY is required');
const { chromium } = await import(playwrightEntry);

const stitcherPath = process.env.STITCHER_JSON || '玲·通用预设缝合机-v2.3.0.json';
const reportPath = process.env.QA_REPORT || 'preset-stitcher-smoke-report.json';
const screenshotPath = process.env.QA_SCREENSHOT || 'preset-stitcher-smoke.png';
const resultPath = process.env.QA_RESULT || 'preset-stitcher-smoke-output.json';
const browserExecutable = process.env.BROWSER_EXECUTABLE;

const raw = fs.readFileSync(stitcherPath, 'utf8');
const script = JSON.parse(raw);
if (!script || script.type !== 'script' || typeof script.content !== 'string') {
  throw new Error('Invalid Tavern Helper global-script JSON');
}
new Function(script.content);

const report = {
  source: path.basename(stitcherPath),
  declaredName: script.name,
  declaredEnabled: script.enabled,
  declaredId: script.id,
  runtimeUrl: 'http://127.0.0.1:8000/',
  runtimeReady: false,
  scriptSyntaxValid: true,
  helperFrameInjected: false,
  mountHost: 'missing',
  panelOpened: false,
  presetCount: 0,
  baseLoaded: false,
  donorLoaded: false,
  selectedCount: 0,
  semanticDisabledForOfflineSmoke: false,
  outputDownloaded: false,
  outputJsonValid: false,
  consoleErrors: [],
  pageErrors: [],
  notes: [],
};

const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('console', msg => {
  if (msg.type() === 'error') report.consoleErrors.push(msg.text());
});
page.on('pageerror', error => report.pageErrors.push(error?.stack || error?.message || String(error)));

let host = null;
try {
  await page.goto(report.runtimeUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => Boolean(window.SillyTavern?.getContext), null, { timeout: 90000 });
  report.runtimeReady = true;

  await page.evaluate(() => {
    const old = document.getElementById('qa-tavern-helper-frame');
    old?.remove();
    const iframe = document.createElement('iframe');
    iframe.id = 'qa-tavern-helper-frame';
    iframe.title = 'QA Tavern Helper sandbox';
    iframe.style.cssText = 'position:fixed;left:12px;bottom:12px;width:420px;height:320px;z-index:2147483000;background:white;border:2px solid #b48cff;';
    iframe.src = 'about:blank';
    document.body.appendChild(iframe);
  });

  const helperFrame = page.frames().find(frame => frame !== page.mainFrame() && frame.url() === 'about:blank');
  if (!helperFrame) throw new Error('Failed to create helper iframe');

  await helperFrame.evaluate(() => {
    try { window.SillyTavern = window.parent.SillyTavern; } catch {}
    try { window.$ = window.parent.$; window.jQuery = window.parent.jQuery; } catch {}
    try { window.toastr = window.parent.toastr; } catch {}
  });
  await helperFrame.evaluate(code => { (0, eval)(code); }, script.content);
  report.helperFrameInjected = true;

  await page.waitForTimeout(1800);
  const topRootCount = await page.locator('#ling-preset-stitcher-root').count();
  const frameRootCount = await helperFrame.locator('#ling-preset-stitcher-root').count();
  if (topRootCount) {
    report.mountHost = 'top-document';
    host = page;
  } else if (frameRootCount) {
    report.mountHost = 'helper-iframe';
    host = helperFrame;
    report.notes.push('UI mounted inside helper iframe instead of the real SillyTavern document.');
  } else {
    throw new Error('Preset stitcher root did not mount in top document or helper iframe');
  }

  const fab = host.locator('#ling-preset-stitcher-root .lps-fab');
  await fab.waitFor({ state: 'visible', timeout: 15000 });
  await fab.click();
  await host.waitForTimeout(300);
  const panel = host.locator('#ling-preset-stitcher-root .lps-panel');
  report.panelOpened = await panel.isVisible().catch(() => false);

  await host.locator('#ling-preset-stitcher-root .lps-refresh-presets').click();
  await host.waitForFunction(() => {
    const root = document.getElementById('ling-preset-stitcher-root');
    const select = root?.querySelector('.lps-base-preset-select');
    return Boolean(select && select.options.length > 1);
  }, null, { timeout: 30000 });

  const baseSelect = host.locator('#ling-preset-stitcher-root .lps-base-preset-select');
  const donorSelect = host.locator('#ling-preset-stitcher-root .lps-donor-preset-select');
  report.presetCount = await baseSelect.locator('option').count() - 1;
  if (report.presetCount < 1) throw new Error('No chat-completion presets found in real SillyTavern');

  await baseSelect.selectOption({ index: 1 });
  await host.locator('#ling-preset-stitcher-root .lps-load-base-preset').click();
  await host.waitForTimeout(800);
  report.baseLoaded = !/等待载入 A 与 B/.test(await host.locator('#ling-preset-stitcher-root .lps-format-state').innerText().catch(() => ''));

  const donorIndex = report.presetCount >= 2 ? 2 : 1;
  await donorSelect.selectOption({ index: donorIndex });
  await host.locator('#ling-preset-stitcher-root .lps-add-donor-preset').click();
  await host.waitForTimeout(1000);
  const componentText = await host.locator('#ling-preset-stitcher-root .lps-component-list').innerText().catch(() => '');
  report.donorLoaded = componentText.trim().length > 0;

  const semantic = host.locator('#ling-preset-stitcher-root input[name="semantic-adapt"]');
  if (await semantic.isChecked().catch(() => false)) await semantic.uncheck();
  report.semanticDisabledForOfflineSmoke = !(await semantic.isChecked().catch(() => true));

  await host.locator('#ling-preset-stitcher-root .lps-select-all').click();
  await host.waitForTimeout(250);
  const selectedText = await host.locator('#ling-preset-stitcher-root .lps-selected-count').innerText();
  const selectedMatch = selectedText.match(/(\d+)/);
  report.selectedCount = selectedMatch ? Number(selectedMatch[1]) : 0;
  if (report.selectedCount < 1) throw new Error('Donor loaded but no selectable components were exposed');

  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await host.locator('#ling-preset-stitcher-root .lps-stitch').click();
  const download = await downloadPromise;
  await download.saveAs(resultPath);
  report.outputDownloaded = true;
  const output = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  report.outputJsonValid = Boolean(output && typeof output === 'object');

  await host.locator('#ling-preset-stitcher-root .lps-fab').screenshot({ path: screenshotPath }).catch(async () => {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  });
} catch (error) {
  report.notes.push(error?.stack || error?.message || String(error));
  try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch {}
} finally {
  await browser.close();
}

const filteredConsoleErrors = report.consoleErrors.filter(text => !/favicon|ERR_BLOCKED_BY_CLIENT/i.test(text));
const pass = report.runtimeReady
  && report.scriptSyntaxValid
  && report.helperFrameInjected
  && report.mountHost === 'top-document'
  && report.panelOpened
  && report.presetCount > 0
  && report.baseLoaded
  && report.donorLoaded
  && report.selectedCount > 0
  && report.semanticDisabledForOfflineSmoke
  && report.outputDownloaded
  && report.outputJsonValid
  && report.pageErrors.length === 0
  && filteredConsoleErrors.length === 0;
report.pass = pass;
report.consoleErrors = filteredConsoleErrors;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!pass) process.exitCode = 1;
