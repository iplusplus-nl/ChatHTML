Here is a complete, self-contained implementation of an accessible color palette lab. It includes HSL controls, a 5-color dynamically generated monochromatic palette, a contrast checker using WCAG standards, and AA/AAA badges.

Save the code below as an `.html` file and open it in any modern browser to use the tool.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Accessible Color Palette Lab</title>
  <style>
    :root {
      --bg-color: #0f172a;
      --panel-bg: #1e293b;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #3b82f6;
      --border: #334155;
      --radius: 12px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: system-ui, -apple-system, sans-serif;
      background-color: var(--bg-color);
      color: var(--text-main);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 1rem;
    }

    .container {
      background: var(--panel-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 2rem;
      width: 100%;
      max-width: 600px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
    }

    h1 {
      font-size: 1.5rem;
      margin-bottom: 1.5rem;
      text-align: center;
      background: linear-gradient(to right, #60a5fa, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .section {
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }
    .section:last-child {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
    }

    h2 { font-size: 1rem; margin-bottom: 1rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;}

    /* Sliders */
    .slider-group {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .slider-row {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .slider-row label {
      width: 40px;
      font-weight: bold;
    }
    input[type=range] {
      flex: 1;
      accent-color: var(--accent);
      cursor: pointer;
    }
    .val-display { width: 50px; text-align: right; font-family: monospace; color: var(--text-muted) }

    /* Palette */
    .palette {
      display: flex;
      gap: 0.5rem;
      height: 100px;
    }
    .swatch {
      flex: 1;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 0.5rem;
      transition: transform 0.2s;
      cursor: pointer;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1);
    }
    .swatch:hover {
      transform: translateY(-4px);
    }
    .swatch-hex {
      font-family: monospace;
      font-size: 0.8rem;
      text-align: center;
      background: rgba(0,0,0,0.5);
      color: white;
      padding: 2px 4px;
      border-radius: 4px;
    }

    /* Contrast Checker */
    .contrast-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
    }
    .contrast-preview-box {
      border-radius: var(--radius);
      padding: 1.5rem;
      text-align: center;
      border: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }
    .contrast-preview-box h3 { font-size: 1.2rem; margin-bottom: 0.5rem; }
    .contrast-preview-box p { font-size: 0.85rem; }

    .contrast-controls {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      justify-content: center;
    }

    .fg-picker {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .fg-picker input[type="color"] {
      background: none;
      border: none;
      width: 40px;
      height: 40px;
      cursor: pointer;
    }

    .ratio-display {
      font-size: 2rem;
      font-weight: bold;
      font-family: monospace;
      margin: 0.5rem 0;
    }

    .badges {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
    }
    .badge {
      text-align: center;
      padding: 0.4rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: bold;
      background: var(--border);
      color: var(--text-muted);
    }
    .badge.pass { background: #059669; color: #fff; }
    .badge.fail { background: #e11d48; color: #fff; }
  </style>
</head>
<body>

  <div class="container">
    <h1>Color Palette Lab</h1>

    <div class="section">
      <h2>Base Color (HSL)</h2>
      <div class="slider-group">
        <div class="slider-row">
          <label>H</label>
          <input type="range" id="h-slider" min="0" max="360" value="217">
          <span class="val-display" id="h-val">217°</span>
        </div>
        <div class="slider-row">
          <label>S</label>
          <input type="range" id="s-slider" min="0" max="100" value="90">
          <span class="val-display" id="s-val">90%</span>
        </div>
        <div class="slider-row">
          <label>L</label>
          <input type="range" id="l-slider" min="0" max="100" value="50">
          <span class="val-display" id="l-val">50%</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Generated Palette</h2>
      <div class="palette" id="palette">
        <!-- Swatches rendered via JS -->
      </div>
    </div>

    <div class="section">
      <h2>Contrast Checker</h2>
      <div class="contrast-grid">
        <div class="contrast-preview-box" id="contrast-preview">
          <h3>Sample Text</h3>
          <p>AA/AAA compliance check</p>
        </div>

        <div class="contrast-controls">
          <div class="fg-picker">
            <label>Foreground:</label>
            <input type="color" id="fg-color" value="#ffffff">
          </div>
          <div>
            <div class="ratio-display" id="ratio-display">1.00:1</div>
            <div class="badges">
              <div class="badge" id="badge-aa-normal">AA Normal</div>
              <div class="badge" id="badge-aaa-normal">AAA Normal</div>
              <div class="badge" id="badge-aa-large">AA Large</div>
              <div class="badge" id="badge-aaa-large">AAA Large</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // State
    const state = { h: 217, s: 90, l: 50, fg: '#ffffff' };

    // Elements
    const elH = document.getElementById('h-slider');
    const elS = document.getElementById('s-slider');
    const elL = document.getElementById('l-slider');
    const elFg = document.getElementById('fg-color');
    const paletteEl = document.getElementById('palette');
    const contrastPreview = document.getElementById('contrast-preview');
    const ratioDisp = document.getElementById('ratio-display');

    // Utility: HSL to RGB
    function hslToRgb(h, s, l) {
      s /= 100; l /= 100;
      const k = n => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
    }

    // Utility: RGB to HEX
    function rgbToHex(r, g, b) {
      return "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }

    // Utility: HEX to RGB
    function hexToRgb(hex) {
      const match = hex.replace('#','').match(/.{1,2}/g);
      return [parseInt(match[0], 16), parseInt(match[1], 16), parseInt(match[2], 16)];
    }

    // Relative Luminance for WCAG Contrast
    function getLuminance(r, g, b) {
      const a = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    }

    function getContrast(rgb1, rgb2) {
      const lum1 = getLuminance(...rgb1);
      const lum2 = getLuminance(...rgb2);
      const brightest = Math.max(lum1, lum2);
      const darkest = Math.min(lum1, lum2);
      return (brightest + 0.05) / (darkest + 0.05);
    }

    function update() {
      // Get values
      state.h = parseInt(elH.value);
      state.s = parseInt(elS.value);
      state.l = parseInt(elL.value);
      state.fg = elFg.value;

      document.getElementById('h-val').textContent = state.h + '°';
      document.getElementById('s-val').textContent = state.s + '%';
      document.getElementById('l-val').textContent = state.l + '%';

      // Generate Palette (Luminance variations)
      const offsets = [-30, -15, 0, 15, 30];
      paletteEl.innerHTML = '';

      let baseHex = '';
      let baseRgb = [];

      offsets.forEach(offset => {
        let curL = Math.max(0, Math.min(100, state.l + offset));
        let rgb = hslToRgb(state.h, state.s, curL);
        let hex = rgbToHex(...rgb);

        if(offset === 0) {
          baseHex = hex;
          baseRgb = rgb;
        }

        const div = document.createElement('div');
        div.className = 'swatch';
        div.style.backgroundColor = hex;
        div.innerHTML = `<span class="swatch-hex">${hex}</span>`;
        paletteEl.appendChild(div);
      });

      // Update Contrast Checker
      const fgRgb = hexToRgb(state.fg);
      contrastPreview.style.backgroundColor = baseHex;
      contrastPreview.style.color = state.fg;

      const ratio = getContrast(fgRgb, baseRgb);
      ratioDisp.textContent = ratio.toFixed(2) + ':1';

      // Update Badges
      const updateBadge = (id, pass) => {
        const el = document.getElementById(id);
        el.className = 'badge ' + (pass ? 'pass' : 'fail');
      };

      updateBadge('badge-aa-normal', ratio >= 4.5);
      updateBadge('badge-aaa-normal', ratio >= 7.0);
      updateBadge('badge-aa-large', ratio >= 3.0);
      updateBadge('badge-aaa-large', ratio >= 4.5);
    }

    // Listeners
    [elH, elS, elL, elFg].forEach(el => el.addEventListener('input', update));

    // Init
    update();
  </script>
</body>
</html>
```
