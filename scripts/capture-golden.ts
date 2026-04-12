/**
 * Capture golden reference screenshots from Babylon.js reference pages.
 *
 * Usage:  tsx scripts/capture-golden.ts <sceneNumber>
 * Example: tsx scripts/capture-golden.ts 5
 *
 * ## Animated-scene synchronization
 *
 * For scenes with animation, the BJS reference page must:
 *   1. Use `scene.useConstantAnimationDeltaTime = true` (16 ms fixed step).
 *   2. Freeze all animations at frame 300 (`animatables.forEach(a => a.pause())`).
 *   3. Expose `canvas.dataset.frameCount` incremented each frame.
 *
 * This script waits for `frameCount >= 300` before capturing, so the golden
 * is taken at the exact same logical animation time that parity tests will
 * later capture the Lite scene (both frozen at frame 300 × 16 ms = 4 800 ms).
 *
 * For static scenes the frame counter may not exist; the script falls back to
 * a settle timeout after `canvas.dataset.ready`.
 */
import { chromium } from 'playwright';
import * as path from 'path';

// Scene registry: sceneNumber → { refPage, outputDir, animated, seekTime }
const SCENES: Record<number, { refPage: string; outputDir: string; animated: boolean; seekTime?: number }> = {
  1: { refPage: 'babylon-ref-scene1.html', outputDir: 'scene1-boombox',   animated: false },
  2: { refPage: 'babylon-ref-scene2.html', outputDir: 'scene2-sphere',    animated: false },
  3: { refPage: 'babylon-ref-scene3.html', outputDir: 'scene3-fog',       animated: false },
  4: { refPage: 'babylon-ref-scene4.html', outputDir: 'scene4-shadows',   animated: false },
  5: { refPage: 'babylon-ref-scene5.html', outputDir: 'scene5-alien',     animated: true, seekTime: 2 },
  6: { refPage: 'babylon-ref-scene6.html', outputDir: 'scene6-pbr-sphere', animated: false },
  7: { refPage: 'babylon-ref-scene7.html', outputDir: 'scene7-chibirex',  animated: true, seekTime: 2 },
  8: { refPage: 'babylon-ref-scene8.html', outputDir: 'scene8-glass-sphere', animated: false },
};

const TARGET_FRAMES = 300;
const DEV_PORT = 5176;

(async () => {
  const sceneNum = Number(process.argv[2]);
  const entry = SCENES[sceneNum];
  if (!entry) {
    console.error(`Usage: tsx scripts/capture-golden.ts <sceneNumber>`);
    console.error(`Available scenes: ${Object.keys(SCENES).join(', ')}`);
    process.exit(1);
  }

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--force-color-profile=srgb'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const urlParams = entry.seekTime ? `?seekTime=${entry.seekTime}` : '';
  await page.goto(`http://localhost:${DEV_PORT}/${entry.refPage}${urlParams}`);

  // Wait for scene ready
  await page.waitForFunction(
    () => document.querySelector('canvas')?.dataset.ready === 'true',
    { timeout: 30_000 },
  );

  if (entry.animated) {
    // Wait for exact frame 300 freeze signal (not >= frameCount)
    console.log(`Waiting for animation freeze at frame ${TARGET_FRAMES}...`);
    await page.waitForFunction(
      () => document.querySelector('canvas')?.dataset.animationFrozen === 'true',
      { timeout: 30_000 },
    );
  }

  // GPU queue flush
  await page.waitForTimeout(500);

  const refPath = path.resolve(__dirname, `../reference/${entry.outputDir}/babylon-ref-golden.png`);
  await page.locator('canvas').screenshot({ path: refPath });
  console.log(`Golden reference saved → ${refPath}`);
  if (entry.animated) {
    const frameCount = await page.evaluate(() =>
      Number(document.querySelector('canvas')?.dataset.frameCount ?? '?'));
    console.log(`  Captured at frame ${frameCount} (target: ${TARGET_FRAMES})`);
  }

  await browser.close();
  process.exit(0);
})();

