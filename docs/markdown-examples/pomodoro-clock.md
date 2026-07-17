Here is a complete, single-file HTML solution for the Pomodoro clock. It includes all requested features, a subtle pulse animation when running, and an analog-inspired circular progress indicator.

Save the code below as an `.html` file (e.g., `pomodoro.html`) and open it in any modern web browser.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pomodoro Timer</title>
<style>
  :root {
    --bg-color: #0f172a;
    --text-color: #f8fafc;
    --focus-color: #ef4444;
    --short-color: #10b981;
    --long-color: #3b82f6;
    --surface: #1e293b;
    --border: #334155;
    --theme: var(--focus-color);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: system-ui, -apple-system, sans-serif;
    background-color: var(--bg-color);
    color: var(--text-color);
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    transition: background-color 0.5s ease;
  }

  .container {
    background: var(--surface);
    padding: 2rem;
    border-radius: 24px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    width: 380px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
  }

  .task-field {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 2px solid var(--border);
    color: var(--text-color);
    font-size: 1rem;
    padding: 0.5rem;
    text-align: center;
    outline: none;
    transition: border-color 0.3s;
  }
  .task-field:focus { border-color: var(--theme); }

  .modes {
    display: flex;
    gap: 0.5rem;
    background: rgba(0,0,0,0.2);
    padding: 0.25rem;
    border-radius: 99px;
  }
  .modes button {
    background: transparent;
    border: none;
    color: #94a3b8;
    padding: 0.5rem 1rem;
    border-radius: 99px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.85rem;
    transition: all 0.3s;
  }
  .modes button.active {
    background: var(--theme);
    color: white;
  }

  .analog-timer {
    position: relative;
    width: 240px;
    height: 240px;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  svg {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    transform: rotate(-90deg);
  }

  circle {
    fill: none;
    stroke-width: 8;
    stroke-linecap: round;
  }
  .bg-circle { stroke: var(--border); }
  .progress-circle {
    stroke: var(--theme);
    stroke-dasharray: 703;
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 1s linear;
  }

  .time-display {
    font-size: 4rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    letter-spacing: -2px;
    z-index: 1;
    text-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }

  .running .time-display {
    animation: pulse 2s infinite ease-in-out;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.85; transform: scale(0.98); }
  }

  .controls {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .btn {
    background: var(--border);
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 12px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    transition: transform 0.1s, background 0.3s;
  }
  .btn:active { transform: scale(0.95); }
  .btn.primary { background: var(--theme); padding: 1rem 2rem; font-size: 1.25rem; }

  .btn-hint {
    font-size: 0.65rem;
    opacity: 0.7;
    margin-top: 0.2rem;
    font-weight: normal;
  }

  .dots {
    display: flex;
    gap: 0.5rem;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--border);
    transition: background 0.3s;
  }
  .dot.active { background: var(--focus-color); box-shadow: 0 0 8px var(--focus-color); }

</style>
</head>
<body>

<div class="container">
  <input type="text" class="task-field" placeholder="What are you focusing on?" />

  <div class="modes">
    <button id="btn-focus" class="active" onclick="setMode('focus')">Focus</button>
    <button id="btn-short" onclick="setMode('short')">Short Break</button>
    <button id="btn-long" onclick="setMode('long')">Long Break</button>
  </div>

  <div class="analog-timer" id="timer-container">
    <svg>
      <circle class="bg-circle" cx="120" cy="120" r="112"></circle>
      <circle class="progress-circle" id="progress" cx="120" cy="120" r="112"></circle>
    </svg>
    <div class="time-display" id="time">25:00</div>
  </div>

  <div class="controls">
    <button class="btn" onclick="resetTimer()">
      Reset
      <span class="btn-hint">[R]</span>
    </button>
    <button class="btn primary" id="btn-toggle" onclick="toggleTimer()">
      Start
      <span class="btn-hint">[Space]</span>
    </button>
    <button class="btn" onclick="skipSession()">
      Skip
      <span class="btn-hint">[S]</span>
    </button>
  </div>

  <div class="dots" id="dots">
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  </div>
</div>

<script>
  const MODES = {
    focus: { time: 25 * 60, color: 'var(--focus-color)' },
    short: { time: 5 * 60, color: 'var(--short-color)' },
    long: { time: 15 * 60, color: 'var(--long-color)' }
  };

  let currentMode = 'focus';
  let timeLeft = MODES.focus.time;
  let isRunning = false;
  let timerId = null;
  let sessionsCompleted = 0;

  const timeEl = document.getElementById('time');
  const progressEl = document.getElementById('progress');
  const toggleBtn = document.getElementById('btn-toggle');
  const timerContainer = document.getElementById('timer-container');
  const root = document.documentElement;
  const dots = document.querySelectorAll('.dot');

  const circumference = 2 * Math.PI * 112;

  function updateDisplay() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timeEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    document.title = `${timeEl.textContent} - Pomodoro`;

    const total = MODES[currentMode].time;
    const offset = circumference - (timeLeft / total) * circumference;
    progressEl.style.strokeDashoffset = offset;
  }

  function setMode(mode) {
    currentMode = mode;
    timeLeft = MODES[mode].time;
    root.style.setProperty('--theme', MODES[mode].color);

    document.querySelectorAll('.modes button').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-${mode}`).classList.add('active');

    pauseTimer();
    updateDisplay();
  }

  function toggleTimer() {
    if (isRunning) pauseTimer();
    else startTimer();
  }

  function startTimer() {
    if (timeLeft <= 0) return;
    isRunning = true;
    timerContainer.classList.add('running');
    toggleBtn.innerHTML = `Pause <span class="btn-hint">[Space]</span>`;

    timerId = setInterval(() => {
      timeLeft--;
      updateDisplay();

      if (timeLeft <= 0) {
        pauseTimer();
        handleSessionEnd();
      }
    }, 1000);
  }

  function pauseTimer() {
    isRunning = false;
    timerContainer.classList.remove('running');
    toggleBtn.innerHTML = `Start <span class="btn-hint">[Space]</span>`;
    clearInterval(timerId);
  }

  function resetTimer() {
    pauseTimer();
    timeLeft = MODES[currentMode].time;
    updateDisplay();
  }

  function skipSession() {
    pauseTimer();
    handleSessionEnd();
  }

  function handleSessionEnd() {
    if (currentMode === 'focus') {
      sessionsCompleted++;
      updateDots();
      if (sessionsCompleted % 4 === 0) setMode('long');
      else setMode('short');
    } else {
      setMode('focus');
    }
    // Auto-start next cycle can be called here if desired: startTimer();
  }

  function updateDots() {
    const activeDots = sessionsCompleted % 4 || (sessionsCompleted > 0 && sessionsCompleted % 4 === 0 ? 4 : 0);
    dots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx < activeDots);
    });
    // Clear dots after a long break (4 completed)
    if (currentMode === 'long') {
      setTimeout(() => {
        dots.forEach(dot => dot.classList.remove('active'));
      }, 1000);
    }
  }

  // Keyboard controls
  document.addEventListener('keydown', (e) => {
    // Prevent triggering if typing in task field
    if (document.activeElement.tagName === 'INPUT') return;

    if (e.code === 'Space') {
      e.preventDefault();
      toggleTimer();
    }
    if (e.code === 'KeyR') resetTimer();
    if (e.code === 'KeyS') skipSession();
  });

  // Init
  updateDisplay();
</script>

</body>
</html>
```
