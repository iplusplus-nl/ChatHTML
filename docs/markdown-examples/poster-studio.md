Here is a complete, self-contained implementation of an interactive typographic poster studio. Save the following code as an `index.html` file and open it in any modern web browser to use it.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Typographic Poster Studio</title>
<style>
  :root {
    --ui-bg: #111;
    --ui-panel: #222;
    --ui-text: #eee;
    --ui-border: #333;
    --ui-accent: #f0f0f0;

    /* Default Poster Variables */
    --p-bg: #e5e5e5;
    --p-text: #1a1a1a;
    --p-shape1: #ff3b28;
    --p-shape2: #0051ff;
    --p-scale: 8vw;
    --p-align: left;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background-color: var(--ui-bg);
    color: var(--ui-text);
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  /* Studio UI */
  .sidebar {
    width: 320px;
    background: var(--ui-panel);
    border-right: 1px solid var(--ui-border);
    padding: 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    overflow-y: auto;
  }

  .sidebar h2 {
    font-size: 1.25rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--ui-border);
  }

  .control-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
  }

  input[type="text"], textarea, select {
    width: 100%;
    background: #000;
    border: 1px solid var(--ui-border);
    color: var(--ui-text);
    padding: 0.75rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.9rem;
  }

  textarea {
    resize: none;
    height: 80px;
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--ui-accent);
  }

  .button-group {
    display: flex;
    gap: 0.5rem;
  }

  button {
    flex: 1;
    background: #000;
    border: 1px solid var(--ui-border);
    color: var(--ui-text);
    padding: 0.75rem;
    cursor: pointer;
    border-radius: 4px;
    font-size: 0.85rem;
    transition: background 0.2s;
  }

  button:hover { background: #333; }
  button.active { background: var(--ui-text); color: #000; }

  .shuffle-btn {
    background: var(--ui-text);
    color: #000;
    font-weight: 600;
    margin-top: auto;
  }
  .shuffle-btn:hover { background: #ccc; }

  /* Poster Preview */
  .preview-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    background: #0a0a0a;
  }

  .poster {
    width: 100%;
    max-width: clamp(300px, 60vh, 600px);
    aspect-ratio: 3 / 4;
    background-color: var(--p-bg);
    position: relative;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    transition: background-color 0.4s;
  }

  .grain {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 10;
    opacity: 0.6;
    mix-blend-mode: multiply;
  }

  .grain.hide { display: none; }

  .typography {
    position: relative;
    z-index: 5;
    width: 100%;
    height: 100%;
    padding: 2rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: var(--p-align);
  }

  .headline {
    font-family: "Impact", "Arial Black", sans-serif;
    font-size: var(--p-scale);
    line-height: 0.85;
    color: var(--p-text);
    text-transform: uppercase;
    word-break: break-word;
    white-space: pre-line;
    transition: color 0.4s;
    mix-blend-mode: normal;
  }

  /* CSS Shapes */
  .shape {
    position: absolute;
    transition: all 0.6s cubic-bezier(0.25, 1, 0.5, 1);
    z-index: 2;
    mix-blend-mode: multiply;
  }

  .shape-circle {
    width: 250px;
    height: 250px;
    border-radius: 50%;
    background: var(--p-shape1);
    top: -50px;
    right: -50px;
  }

  .shape-square {
    width: 300px;
    height: 300px;
    background: var(--p-shape2);
    bottom: -100px;
    left: -50px;
    transform: rotate(15deg);
  }
</style>
</head>
<body>

  <!-- SVG Filter for Grain -->
  <svg width="0" height="0" style="position: absolute;">
    <filter id="noiseFilter">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/>
    </filter>
  </svg>

  <div class="sidebar">
    <h2>STUDIO_</h2>

    <div class="control-group">
      <label>Headline</label>
      <textarea id="cmd-text">MOVE
WITH
INTENT</textarea>
    </div>

    <div class="control-group">
      <label>Palette</label>
      <select id="cmd-palette">
        <option value="bauhaus">Bauhaus (Light)</option>
        <option value="cyber">Midnight (Dark)</option>
        <option value="mono">Strict Mono</option>
        <option value="acid">Acid (Vibrant)</option>
      </select>
    </div>

    <div class="control-group">
      <label>Type Scale</label>
      <input type="range" id="cmd-scale" min="4" max="15" value="8" step="0.5">
    </div>

    <div class="control-group">
      <label>Alignment</label>
      <div class="button-group">
        <button class="align-btn active" data-align="left">L</button>
        <button class="align-btn" data-align="center">C</button>
        <button class="align-btn" data-align="right">R</button>
      </div>
    </div>

    <div class="control-group">
      <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
        <input type="checkbox" id="cmd-grain" checked>
        Film Grain
      </label>
    </div>

    <button class="shuffle-btn" id="cmd-shuffle">SHUFFLE LAYOUT</button>
  </div>

  <div class="preview-area">
    <div class="poster" id="poster">
      <div class="grain" id="grain" style="filter: url(#noiseFilter);"></div>
      <div class="shape shape-circle" id="shape1"></div>
      <div class="shape shape-square" id="shape2"></div>
      <div class="typography">
        <div class="headline" id="poster-text">MOVE<br>WITH<br>INTENT</div>
      </div>
    </div>
  </div>

  <script>
    const root = document.documentElement;

    // Elements
    const textInput = document.getElementById('cmd-text');
    const posterText = document.getElementById('poster-text');
    const scaleInput = document.getElementById('cmd-scale');
    const paletteSelect = document.getElementById('cmd-palette');
    const alignBtns = document.querySelectorAll('.align-btn');
    const grainToggle = document.getElementById('cmd-grain');
    const grainOverlay = document.getElementById('grain');
    const shuffleBtn = document.getElementById('cmd-shuffle');
    const shape1 = document.getElementById('shape1');
    const shape2 = document.getElementById('shape2');

    // Palettes
    const palettes = {
      bauhaus: { bg: '#e5e5e5', text: '#1a1a1a', s1: '#ff3b28', s2: '#0051ff' },
      cyber: { bg: '#121214', text: '#e0e0e0', s1: '#ff0055', s2: '#00f0ff' },
      mono: { bg: '#eeeeee', text: '#000000', s1: '#bbbbbb', s2: '#555555' },
      acid: { bg: '#2900ff', text: '#ccff00', s1: '#ff00ff', s2: '#00ffff' }
    };

    // Text Update
    textInput.addEventListener('input', (e) => {
      posterText.innerHTML = e.target.value.replace(/\n/g, '<br>');
    });

    // Scale Update
    scaleInput.addEventListener('input', (e) => {
      root.style.setProperty('--p-scale', `${e.target.value}cqw`);
      // using cqw (container query width) if available, but fallback to % / vw
      // To keep it simple and responsive inside the poster, let's use cqw.
      // Need to add container-type to poster for cqw to work perfectly.
    });

    document.getElementById('poster').style.containerType = 'inline-size';

    // Palette Update
    paletteSelect.addEventListener('change', (e) => {
      const p = palettes[e.target.value];
      root.style.setProperty('--p-bg', p.bg);
      root.style.setProperty('--p-text', p.text);
      root.style.setProperty('--p-shape1', p.s1);
      root.style.setProperty('--p-shape2', p.s2);

      // Update blend modes based on background darkness
      const mixMode = e.target.value === 'cyber' || e.target.value === 'acid' ? 'screen' : 'multiply';
      shape1.style.mixBlendMode = mixMode;
      shape2.style.mixBlendMode = mixMode;
    });

    // Alignment Update
    alignBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        alignBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        root.style.setProperty('--p-align', e.target.dataset.align);
      });
    });

    // Grain Update
    grainToggle.addEventListener('change', (e) => {
      if (e.target.checked) grainOverlay.classList.remove('hide');
      else grainOverlay.classList.add('hide');
    });

    // Shuffle Layout (Shapes)
    shuffleBtn.addEventListener('click', () => {
      const randomPos = () => Math.floor(Math.random() * 80) - 20; // -20% to 60%
      const randomSize = () => Math.floor(Math.random() * 200) + 150;
      const randomRot = () => Math.floor(Math.random() * 360);
      const randomRadius = () => Math.random() > 0.5 ? '50%' : '0%';

      shape1.style.top = `${randomPos()}%`;
      shape1.style.left = `${randomPos()}%`;
      shape1.style.width = `${randomSize()}px`;
      shape1.style.height = `${randomSize()}px`;
      shape1.style.borderRadius = randomRadius();
      shape1.style.transform = `rotate(${randomRot()}deg)`;

      shape2.style.bottom = `${randomPos()}%`;
      shape2.style.right = `${randomPos()}%`;
      shape2.style.width = `${randomSize()}px`;
      shape2.style.height = `${randomSize()}px`;
      shape2.style.borderRadius = randomRadius();
      shape2.style.transform = `rotate(${randomRot()}deg)`;
    });

    // Trigger initial scale setup mapped to cqw
    root.style.setProperty('--p-scale', `${scaleInput.value}cqw`);
  </script>
</body>
</html>
```
