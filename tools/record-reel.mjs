/**
 * Records a 1080x1920 Instagram Reel of an automated playthrough.
 *
 *   npm run reel            (needs the dev server on :5180)
 *
 * Playwright records WebM, then ffmpeg transcodes to H.264 MP4 with a silent
 * audio track, which is what Instagram expects.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const RAW_DIR = join(ROOT, 'demo', '.raw');
const OUT = join(ROOT, 'demo', 'kql-quest-reel.mp4');
const URL = process.env.REEL_URL ?? 'http://localhost:5180/';
const FFMPEG = join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');

const W = 1080;
const H = 1920;
const STAGE_TOP = 140;
const STAGE_H = 1440;
const STAGE_BOTTOM = H - STAGE_TOP - STAGE_H;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REEL_CSS = `
  html, body { width:${W}px; height:${H}px; overflow:hidden; background:#04070e; }
  #page-footer { display:none !important; }
  #game {
    position:fixed !important; left:0 !important; top:${STAGE_TOP}px !important;
    width:${W}px !important; height:${STAGE_H}px !important;
  }
  .game-hud { inset:${STAGE_TOP}px 0 ${STAGE_BOTTOM}px 0 !important; }
  .terminal-overlay { inset:${STAGE_TOP}px 0 ${STAGE_BOTTOM}px 0 !important; padding:0 !important; }
  .terminal-panel { width:100% !important; height:100% !important; border-radius:0 !important; border:none !important; }
  .hud-stats { font-size:22px !important; padding:12px 20px !important; }
  .hud-prompt { font-size:26px !important; padding:16px 28px !important; }
  .mission-name { font-size:34px !important; }
  .mission-badge { font-size:17px !important; }
  .mission-brief, .objective-box, .checklist li, .hint-list li { font-size:20px !important; line-height:1.55 !important; }
  .schema-title { font-size:19px !important; }
  .schema-desc, .col-chip { font-size:16px !important; }
  .status-line { font-size:21px !important; padding:16px 22px !important; }
  .clue-text { font-size:20px !important; }
  .clue-tag { font-size:15px !important; }
  .result-pane table { font-size:18px !important; }
  .result-pane th { padding:12px 16px !important; }
  .result-pane td { padding:11px 16px !important; }
  .primary-btn, .ghost-btn { font-size:19px !important; padding:14px 20px !important; }
  .brief-pane { padding:26px !important; }
  .check-mark { font-size:20px !important; }

  .reel-top {
    position:fixed; top:0; left:0; width:${W}px; height:${STAGE_TOP}px; z-index:200;
    display:flex; align-items:center; justify-content:center; gap:16px;
    background:#04070e; font-family:'Segoe UI',system-ui,sans-serif;
  }
  .reel-logo {
    font-family:'Cascadia Code',Consolas,monospace; font-size:34px; font-weight:700;
    color:#7dd3fc; letter-spacing:2px;
  }
  .reel-sub { font-size:24px; color:#64748b; }
  .reel-bottom {
    position:fixed; left:0; top:${STAGE_TOP + STAGE_H}px; width:${W}px; height:${STAGE_BOTTOM}px;
    z-index:200; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px;
    padding:0 60px; box-sizing:border-box; text-align:center;
    background:linear-gradient(0deg,#04070e 68%,rgba(4,7,14,0));
    font-family:'Segoe UI',system-ui,sans-serif;
  }
  .reel-caption {
    font-size:44px; font-weight:700; color:#f1f5f9; line-height:1.25;
    opacity:0; transform:translateY(14px); transition:opacity .45s ease, transform .45s ease;
  }
  .reel-caption.show { opacity:1; transform:none; }
  .reel-cta { font-size:23px; color:#5eead4; letter-spacing:.5px; }
`;

const REEL_HTML = `
  <div class="reel-top">
    <div class="reel-logo">KQL QUEST</div>
    <div class="reel-sub">· learn Kusto by playing</div>
  </div>
  <div class="reel-bottom">
    <div class="reel-caption"></div>
    <div class="reel-cta">Runs in any browser \u00b7 phone or desktop</div>
  </div>
`;

async function setCaption(page, text) {
  await page.evaluate((value) => {
    const el = document.querySelector('.reel-caption');
    el.classList.remove('show');
    setTimeout(() => {
      el.textContent = value;
      el.classList.add('show');
    }, 220);
  }, text);
  await sleep(420);
}

async function playerX(page) {
  return page.evaluate(() => window.__game.scene.getScene('Play')?.player?.x ?? -1);
}

async function walkTo(page, targetX, { jumpAt = null } = {}) {
  await page.keyboard.down('KeyD');
  let jumped = false;
  let x = -1;
  for (let i = 0; i < 200; i++) {
    x = await playerX(page);
    if (jumpAt !== null && !jumped && x >= jumpAt) {
      jumped = true;
      await page.keyboard.press('Space');
    }
    if (x >= targetX) break;
    await sleep(40);
  }
  await page.keyboard.up('KeyD');
  console.log(`  walked to x=${Math.round(x)} (target ${Math.round(targetX)})`);
  return x;
}

async function record() {
  rmSync(RAW_DIR, { recursive: true, force: true });
  mkdirSync(RAW_DIR, { recursive: true });

  const browser = await chromium.launch({
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--hide-scrollbars',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: RAW_DIR, size: { width: W, height: H } },
    reducedMotion: 'no-preference',
  });
  await context.addInitScript(
    ({ css, html }) => {
      try {
        localStorage.clear();
      } catch {
        /* storage may be blocked */
      }
      const apply = () => {
        if (!document.getElementById('reel-style')) {
          const style = document.createElement('style');
          style.id = 'reel-style';
          style.textContent = css;
          (document.head ?? document.documentElement)?.appendChild(style);
        }
        if (document.body && !document.querySelector('.reel-top')) {
          document.body.insertAdjacentHTML('beforeend', html);
        }
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
      } else {
        apply();
      }
    },
    { css: REEL_CSS, html: REEL_HTML },
  );

  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'load' });

  // Belt and braces: guarantee the reel chrome exists before the first caption.
  await page.addStyleTag({ content: REEL_CSS }).catch(() => {});
  await page.evaluate((html) => {
    if (!document.querySelector('.reel-top')) document.body.insertAdjacentHTML('beforeend', html);
  }, REEL_HTML);

  await page.waitForFunction(() => window.__game?.scene?.getScene('Menu')?.root, null, { timeout: 15000 });
  // The container is smaller than the window in reel mode; make the game notice.
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));

  // A promo should not advertise the reset button, and the menu may rebuild once.
  const hideReset = () =>
    page.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      if (!menu?.root) return false;
      const index = menu.root.list.findIndex((o) => o.type === 'Text' && o.text === 'Reset progress');
      if (index < 0) return false;
      menu.root.list[index].setVisible(false);
      if (index > 0) menu.root.list[index - 1].setVisible(false);
      return true;
    });
  for (let i = 0; i < 5; i++) {
    await hideReset();
    await sleep(120);
  }

  await setCaption(page, 'A 2D platformer that teaches KQL');
  await sleep(2400);

  // --- enter world 1 -------------------------------------------------------
  await setCaption(page, 'Two worlds. Eight missions.');
  await sleep(1500);

  const button = await page.evaluate(() => {
    const game = window.__game;
    const menu = game.scene.getScene('Menu');
    const cam = menu.cameras.main;
    const scale = game.scale;
    const rect = game.canvas.getBoundingClientRect();
    const target = menu.root.list.find((o) => o.type === 'Rectangle' && o.input?.enabled);
    const m = target.getWorldTransformMatrix();
    return {
      x: rect.left + ((m.tx - cam.worldView.x) * cam.zoom) / scale.displayScale.x,
      y: rect.top + ((m.ty - cam.worldView.y) * cam.zoom) / scale.displayScale.y,
    };
  });
  await page.mouse.click(button.x, button.y);
  await page.waitForFunction(() => window.__game.scene.getScene('Play')?.sys.settings.status === 5, null, { timeout: 10000 });
  // A vertical frame shows a lot of sky; crop in so the character fills more of it.
  await page.evaluate(() => {
    const play = window.__game.scene.getScene('Play');
    play.cameras.main.setZoom(play.cameras.main.zoom * 1.32);
  });
  await sleep(900);

  // --- platforming ---------------------------------------------------------
  const terminalX = await page.evaluate(
    () => window.__game.scene.getScene('Play').terminals[0].container.x,
  );
  console.log('  terminal 1 at x =', Math.round(terminalX));

  await setCaption(page, 'Run, jump, explore the estate');
  await sleep(400);
  await walkTo(page, terminalX - 150);
  await page.keyboard.press('Space');
  await sleep(500);
  await walkTo(page, terminalX - 10);
  await sleep(600);

  // --- open a mission ------------------------------------------------------
  await setCaption(page, 'Terminals are missions');
  await page.waitForSelector('.hud-prompt:not([hidden])', { timeout: 8000 });
  await sleep(900);
  await page.keyboard.down('KeyE');
  await sleep(320);
  await page.keyboard.up('KeyE');
  await page.waitForSelector('.terminal-overlay:not([hidden])', { timeout: 10000 });
  await sleep(1100);

  await setCaption(page, 'Write real Kusto against real tables');
  await sleep(1800);

  await page.click('.editor-host');
  await sleep(300);
  await page.keyboard.type('| take 5', { delay: 105 });
  await sleep(900);

  await setCaption(page, 'Graded instantly \u2014 no Azure needed');
  await sleep(600);
  await page.click('.run-btn');
  await sleep(1100);

  await setCaption(page, 'Every correct query unlocks evidence');
  await sleep(3300);

  // --- back to the world ---------------------------------------------------
  await page.click('.continue-btn');
  await sleep(1200);
  await setCaption(page, 'Solve the breach, one query at a time');
  await walkTo(page, terminalX + 100, { jumpAt: terminalX + 60 });
  await sleep(1300);

  await setCaption(page, 'KQL Quest \u2014 play it in your browser');
  await sleep(2200);

  await context.close();
  await browser.close();

  const file = readdirSync(RAW_DIR).find((f) => f.endsWith('.webm'));
  if (!file) throw new Error('Playwright produced no video');
  return join(RAW_DIR, file);
}

function transcode(webm) {
  if (!existsSync(FFMPEG)) throw new Error(`ffmpeg not found at ${FFMPEG}`);
  mkdirSync(join(ROOT, 'demo'), { recursive: true });
  execFileSync(
    FFMPEG,
    [
      '-y',
      // Skip the boot frames before the menu paints.
      '-ss', '1.9',
      '-i', webm,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-shortest',
      '-vf', `scale=${W}:${H}:flags=lanczos,fps=30,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
      '-profile:v', 'high', '-level', '4.0',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      OUT,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  return OUT;
}

const webm = await record();
console.log('recorded', webm);
const mp4 = transcode(webm);
const size = (statSync(mp4).size / 1024 / 1024).toFixed(1);
console.log(`\nReel ready: ${mp4}  (${size} MB, ${W}x${H})`);
