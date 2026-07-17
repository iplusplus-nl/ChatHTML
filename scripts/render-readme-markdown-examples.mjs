import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const outputDirectory = "docs/images";

const examples = [
  {
    slug: "markdown-pomodoro-clock",
    height: 824,
    body: `
      <p>Here is a compact Pomodoro implementation. Save this as an HTML file to run the timer:</p>
      <pre><code>&lt;div class="timer"&gt;
  &lt;button data-mode="focus"&gt;Focus&lt;/button&gt;
  &lt;output id="clock"&gt;25:00&lt;/output&gt;
  &lt;button id="start"&gt;Start&lt;/button&gt;
  &lt;button id="reset"&gt;Reset&lt;/button&gt;
&lt;/div&gt;

&lt;script&gt;
  // decrement the remaining seconds each tick
  // switch to a break when the session ends
&lt;/script&gt;</code></pre>
      <p>Add keyboard handlers for <code>Space</code>, <code>R</code>, and <code>S</code>, plus four dots to track completed focus sessions.</p>
    `
  },
  {
    slug: "markdown-lancer-evolution-gallery",
    height: 822,
    body: `
      <p>Here is a compact retrospective of four Mitsubishi Lancer Evolution generations:</p>
      <table>
        <tr><th>Generation</th><th>Years</th><th>Photo credit</th></tr>
        <tr><td>Evolution III</td><td>1995</td><td>Charles · CC BY 2.0</td></tr>
        <tr><td>Evolution VI</td><td>1999–2001</td><td>Motoring Weapon R · CC BY-SA 3.0</td></tr>
        <tr><td>Evolution IX</td><td>2005–2007</td><td>FotoSleuth · CC BY 2.0</td></tr>
        <tr><td>Evolution X</td><td>2007–2016</td><td>IFCAR · Public domain</td></tr>
      </table>
      <h3>Image links</h3>
      <ul class="compact">
        <li><a href="#">View Evolution III photo</a></li>
        <li><a href="#">View Evolution VI photo</a></li>
        <li><a href="#">View Evolution IX photo</a></li>
        <li><a href="#">View Evolution X photo</a></li>
      </ul>
      <p>All images are hosted by Wikimedia Commons under the licenses shown above.</p>
    `
  },
  {
    slug: "markdown-game-2048",
    height: 570,
    body: `
      <p>Below is the core board markup for a browser-based 2048 game:</p>
      <pre><code>&lt;div class="board"&gt;
  &lt;button&gt;128&lt;/button&gt; &lt;button&gt;64&lt;/button&gt;
  &lt;button&gt;32&lt;/button&gt;  &lt;button&gt;16&lt;/button&gt;
  &lt;!-- twelve more cells --&gt;
&lt;/div&gt;</code></pre>
      <p>Add arrow-key and touch handlers, then merge equal neighboring values after each move.</p>
    `
  },
  {
    slug: "markdown-poster-studio",
    height: 700,
    body: `
      <p>Use this structure for an editable typographic poster:</p>
      <pre><code>&lt;article class="poster"&gt;
  &lt;h1 contenteditable&gt;MOVE&lt;br&gt;WITH&lt;br&gt;INTENT&lt;/h1&gt;
  &lt;i class="shape circle"&gt;&lt;/i&gt;
  &lt;i class="shape wedge"&gt;&lt;/i&gt;
&lt;/article&gt;</code></pre>
      <h3>Suggested controls</h3>
      <ul class="compact">
        <li>Palette and type-scale inputs</li>
        <li>Grain-density and alignment controls</li>
        <li>A button that shuffles the CSS shapes</li>
      </ul>
      <p>Apply the selected values as CSS custom properties on the poster element.</p>
    `
  },
  {
    slug: "markdown-bezier-playground",
    height: 944,
    body: `
      <p>A cubic Bézier curve is controlled by four points: the two endpoints <em>P₀</em> and <em>P₃</em>, plus control points <em>P₁</em> and <em>P₂</em>.</p>
      <div class="formula">B(t) = (1−t)³P₀ + 3(1−t)²tP₁ + 3(1−t)t²P₂ + t³P₃</div>
      <h3>How to experiment</h3>
      <ol>
        <li>Move <em>P₁</em> to change how the curve leaves the start.</li>
        <li>Move <em>P₂</em> to change how it approaches the end.</li>
        <li>Compare common presets such as ease, ease-in, and ease-out.</li>
      </ol>
      <pre><code>const point = cubicBezier(t, p0, p1, p2, p3);
ctx.lineTo(point.x, point.y);</code></pre>
      <p>You can paste this into an HTML canvas example and add range inputs for the four control-point coordinates.</p>
    `
  },
  {
    slug: "markdown-split-calculator",
    height: 809,
    body: `
      <p>For a €186.50 dinner shared by 4 people, here is the breakdown using a 15% tip:</p>
      <table>
        <tr><th>Item</th><th>Amount</th></tr>
        <tr><td>Bill</td><td>€186.50</td></tr>
        <tr><td>Tip (15%)</td><td>€27.97</td></tr>
        <tr><td>Total</td><td>€214.47</td></tr>
        <tr class="total"><td>Per person</td><td>€53.62</td></tr>
      </table>
      <pre><code>perPerson = (bill * (1 + tip / 100)) / people</code></pre>
      <p>Change the values in the formula to calculate a different bill, tip percentage, or party size.</p>
    `
  },
  {
    slug: "markdown-request-pipeline",
    height: 628,
    body: `
      <p>After you press Enter, the browser works through these stages:</p>
      <ol class="compact">
        <li><strong>DNS</strong> — resolve <code>example.com</code> to an IP address.</li>
        <li><strong>TCP</strong> — open a reliable connection to the server.</li>
        <li><strong>TLS</strong> — negotiate encryption and verify the certificate.</li>
        <li><strong>HTTP</strong> — request the document and receive a response.</li>
        <li><strong>Render</strong> — parse HTML and CSS, lay out pixels, and paint.</li>
      </ol>
      <p>Each stage depends on the previous one, though caches and connection reuse can skip some work.</p>
    `
  },
  {
    slug: "markdown-color-lab",
    height: 690,
    body: `
      <p>Here is a five-color palette centered on hue 210°, with a quick contrast check:</p>
      <table>
        <tr><th>Role</th><th>Hex</th><th>Use</th></tr>
        <tr><td>Navy</td><td><code>#051A2E</code></td><td>Background</td></tr>
        <tr><td>Blue</td><td><code>#1980E6</code></td><td>Primary</td></tr>
        <tr><td>Sky</td><td><code>#BAD9F7</code></td><td>Light accent</td></tr>
        <tr><td>Orange</td><td><code>#E68019</code></td><td>Contrast accent</td></tr>
        <tr><td>Indigo</td><td><code>#0000CC</code></td><td>Deep accent</td></tr>
      </table>
      <p><strong>WCAG note:</strong> target at least 4.5:1 for normal text and 3:1 for large text. Recalculate the ratio whenever either color changes.</p>
    `
  }
];

const styles = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 852px; overflow: hidden; }
  body {
    min-height: var(--capture-height);
    padding: 42px;
    color: #ececf1;
    background:
      radial-gradient(circle at 88% 0%, rgba(66, 78, 255, 0.11), transparent 36%),
      #171719;
    font: 19px/1.62 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .shell {
    min-height: calc(var(--capture-height) - 84px);
    border: 1px solid #34343a;
    border-radius: 18px;
    overflow: hidden;
    background: #202023;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 66px;
    padding: 0 24px;
    color: #b9b9c1;
    border-bottom: 1px solid #34343a;
    background: #1b1b1e;
    font-size: 15px;
    font-weight: 650;
    letter-spacing: 0.02em;
  }
  .mark {
    display: grid;
    width: 31px;
    height: 31px;
    place-items: center;
    color: #171719;
    border-radius: 8px;
    background: #d8d8df;
    font-size: 14px;
    font-weight: 850;
  }
  .message { padding: 30px 36px 38px; }
  .label {
    margin-bottom: 14px;
    color: #8d8d98;
    font-size: 13px;
    font-weight: 750;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  p { margin: 0 0 20px; }
  h3 { margin: 25px 0 10px; color: #fff; font-size: 18px; }
  ol { margin: 8px 0 24px; padding-left: 27px; }
  li { margin: 8px 0; padding-left: 5px; }
  .compact li { margin: 6px 0; }
  code { color: #d9d9e3; font: 0.88em/1.5 "Cascadia Code", Consolas, monospace; }
  pre {
    margin: 22px 0;
    padding: 19px 21px;
    overflow: hidden;
    color: #d8d8e2;
    border: 1px solid #3b3b42;
    border-radius: 10px;
    background: #101012;
    white-space: pre-wrap;
  }
  pre code { font-size: 14px; }
  .formula {
    margin: 22px 0;
    padding: 20px;
    color: #f0f0f7;
    border-left: 3px solid #8b86ff;
    background: #19191c;
    font: 17px/1.5 "Cambria Math", Georgia, serif;
  }
  table { width: 100%; margin: 22px 0; border-collapse: collapse; font-size: 16px; }
  th, td { padding: 11px 13px; text-align: left; border: 1px solid #414148; }
  th { color: #f4f4f7; background: #29292e; }
  td:last-child { color: #d6d4ff; }
  .total td { font-weight: 800; background: #282735; }
`;

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 852, height: 944 }, deviceScaleFactor: 1 });
  for (const example of examples) {
    await page.setViewportSize({ width: 852, height: example.height });
    await page.setContent(`<!doctype html>
      <html>
        <head><meta charset="utf-8"><style>${styles}</style></head>
        <body style="--capture-height: ${example.height}px">
          <main class="shell">
            <header class="topbar"><span class="mark">MD</span> Markdown chat</header>
            <article class="message">
              <div class="label">Assistant response</div>
              ${example.body}
            </article>
          </main>
        </body>
      </html>`);
    await page.screenshot({ path: `${outputDirectory}/${example.slug}.png` });
  }
} finally {
  await browser.close();
}
