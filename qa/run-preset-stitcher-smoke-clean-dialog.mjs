import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const sourcePath = 'qa/preset-stitcher-smoke.mjs';
const runtimePath = 'qa/.preset-stitcher-smoke-runtime.mjs';
let source = fs.readFileSync(sourcePath, 'utf8');

const marker = "  const fab = host.locator('#ling-preset-stitcher-root .lps-fab');";
if (!source.includes(marker)) throw new Error('Smoke harness insertion marker not found');

source = source.replace(marker, `  // A clean SillyTavern profile can show a first-run native dialog.\n  // It is unrelated to the stitcher and would intercept pointer events in headless QA.\n  await page.evaluate(() => {\n    for (const dialog of document.querySelectorAll('dialog[open]')) {\n      if (dialog.closest?.('#ling-preset-stitcher-root')) continue;\n      try { dialog.close(); } catch { dialog.removeAttribute('open'); }\n    }\n  });\n  await page.waitForTimeout(200);\n\n${marker}`);
source = source.replace('  await fab.click();', '  await fab.click({ force: true });');

const originalDonorBlock = `  const donorIndex = report.presetCount >= 2 ? 2 : 1;\n  await donorSelect.selectOption({ index: donorIndex });\n  await host.locator('#ling-preset-stitcher-root .lps-add-donor-preset').click();\n  await host.waitForTimeout(1000);`;
const fixtureDonorBlock = `  if (report.presetCount >= 2) {\n    await donorSelect.selectOption({ index: 2 });\n    await host.locator('#ling-preset-stitcher-root .lps-add-donor-preset').click();\n  } else {\n    // Fresh SillyTavern ships only one chat-completion preset. Use a second independent\n    // preset through the stitcher's supported local-file path so A is not the same as B.\n    await host.locator('#ling-preset-stitcher-root .lps-donor-input').setInputFiles(\n      path.resolve('qa/fixtures/donor-minimal.json'),\n    );\n    report.notes.push('Clean Tavern had one built-in preset; donor loaded from local fixture.');\n  }\n  await host.waitForTimeout(1000);`;
if (!source.includes(originalDonorBlock)) throw new Error('Donor block marker not found');
source = source.replace(originalDonorBlock, fixtureDonorBlock);

fs.writeFileSync(runtimePath, source, 'utf8');
const result = spawnSync(process.execPath, [runtimePath], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
