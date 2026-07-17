Here is a complete, self-contained HTML file containing the interactive editorial gallery. It uses CSS Grid to ensure the 2-by-2 layout and all essential elements remain visible within a single viewport, and includes custom interactions for filtering and the click-to-expand lightbox.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Evolution / I–X</title>
    <style>
        :root {
            --bg-color: #111;
            --text-main: #eee;
            --text-muted: #aaa;
            --accent: #d32f2f;
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            background-color: var(--bg-color);
            color: var(--text-main);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        header {
            padding: 1rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #333;
            flex-shrink: 0;
        }
        h1 {
            font-size: 1.25rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            margin: 0;
        }
        .filters {
            display: flex;
            gap: 0.5rem;
        }
        .filter-btn {
            background: transparent;
            border: 1px solid #444;
            color: var(--text-main);
            padding: 0.25rem 0.75rem;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85rem;
            transition: all 0.2s;
        }
        .filter-btn:hover, .filter-btn.active {
            background: var(--text-main);
            color: var(--bg-color);
            border-color: var(--text-main);
        }
        .gallery {
            flex-grow: 1;
            display: grid;
            grid-template-columns: 1fr 1fr;
            grid-template-rows: 1fr 1fr;
            gap: 4px;
            padding: 4px;
            overflow: hidden;
        }
        .card {
            position: relative;
            cursor: pointer;
            overflow: hidden;
            background: #222;
        }
        .card img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            transition: transform 0.4s ease;
        }
        .card:hover img {
            transform: scale(1.03);
        }
        .overlay {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 100%);
            padding: 1rem;
            pointer-events: none;
        }
        .title {
            font-weight: bold;
            font-size: 1.1rem;
            margin-bottom: 0.2rem;
        }
        .meta {
            font-size: 0.75rem;
            color: var(--text-muted);
            line-height: 1.4;
        }
        .disclaimer {
            font-size: 0.65rem;
            color: #666;
            text-align: center;
            padding: 4px;
            flex-shrink: 0;
            background: #000;
        }
        /* Lightbox styling */
        .lightbox {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.95);
            display: none;
            justify-content: center;
            align-items: center;
            flex-direction: column;
            z-index: 1000;
            padding: 2rem;
        }
        .lightbox.open {
            display: flex;
        }
        .lightbox img {
            max-width: 100%;
            max-height: 80vh;
            object-fit: contain;
            border: 1px solid #333;
        }
        .lightbox-caption {
            margin-top: 1rem;
            text-align: center;
            font-size: 0.9rem;
            color: var(--text-muted);
        }
        .close-btn {
            position: absolute;
            top: 1.5rem;
            right: 1.5rem;
            background: transparent;
            color: #fff;
            border: none;
            font-size: 2rem;
            cursor: pointer;
        }
        /* Filter hidden state */
        .hidden {
            display: none;
        }

        @media (max-width: 600px) {
            header { flex-direction: column; gap: 1rem; align-items: flex-start; }
            .gallery { grid-template-columns: 1fr; grid-template-rows: repeat(4, 1fr); overflow-y: auto;}
            body { height: auto; min-height: 100vh; overflow: auto; }
        }
    </style>
</head>
<body>

    <header>
        <h1>Evolution / I–X</h1>
        <div class="filters">
            <button class="filter-btn active" data-filter="all">All</button>
            <button class="filter-btn" data-filter="III">III</button>
            <button class="filter-btn" data-filter="VI">VI</button>
            <button class="filter-btn" data-filter="IX">IX</button>
            <button class="filter-btn" data-filter="X">X</button>
        </div>
    </header>

    <div class="gallery" id="gallery">
        <div class="card" data-gen="III" onclick="openLightbox(this)">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Mitsubishi_Lancer_Evolution_III_%281995%29_%2853619429931%29.jpg/1280px-Mitsubishi_Lancer_Evolution_III_%281995%29_%2853619429931%29.jpg" alt="Lancer Evolution III" loading="eager">
            <div class="overlay">
                <div class="title">Evolution III (1995)</div>
                <div class="meta">Photo: Charles from Port Chester, NY<br>License: CC BY 2.0</div>
            </div>
        </div>

        <div class="card" data-gen="VI" onclick="openLightbox(this)">
            <img src="https://upload.wikimedia.org/wikipedia/commons/d/d3/Mitsubishi_Lancer_Evolution_VI.jpg" alt="Lancer Evolution VI" loading="eager">
            <div class="overlay">
                <div class="title">Evolution VI (1999–2001)</div>
                <div class="meta">Photo: Motoring Weapon R<br>License: CC BY-SA 3.0</div>
            </div>
        </div>

        <div class="card" data-gen="IX" onclick="openLightbox(this)">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Mitsubishi_Lancer_Evolution_IX_%2831677018768%29.jpg/1280px-Mitsubishi_Lancer_Evolution_IX_%2831677018768%29.jpg" alt="Lancer Evolution IX" loading="eager">
            <div class="overlay">
                <div class="title">Evolution IX (2005–2007)</div>
                <div class="meta">Photo: FotoSleuth<br>License: CC BY 2.0</div>
            </div>
        </div>

        <div class="card" data-gen="X" onclick="openLightbox(this)">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Mitsubishi_Lancer_EVO_X.jpg/1280px-Mitsubishi_Lancer_EVO_X.jpg" alt="Lancer Evolution X" loading="eager">
            <div class="overlay">
                <div class="title">Evolution X (2007–2016)</div>
                <div class="meta">Photo: IFCAR<br>License: Public Domain</div>
            </div>
        </div>
    </div>

    <div class="disclaimer">
        Images are sourced from Wikimedia Commons. Usage does not imply endorsement by Mitsubishi or the respective photographers.
    </div>

    <!-- Lightbox -->
    <div class="lightbox" id="lightbox">
        <button class="close-btn" onclick="closeLightbox()">&times;</button>
        <img id="lb-img" src="" alt="Full Resolution">
        <div class="lightbox-caption" id="lb-cap"></div>
    </div>

    <script>
        // Filtering Logic
        const filterBtns = document.querySelectorAll('.filter-btn');
        const cards = document.querySelectorAll('.card');

        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                // Update active state
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const filterValue = btn.getAttribute('data-filter');

                cards.forEach(card => {
                    const gen = card.getAttribute('data-gen');
                    if (filterValue === 'all' || filterValue === gen) {
                        card.classList.remove('hidden');
                    } else {
                        card.classList.add('hidden');
                    }
                });
            });
        });

        // Lightbox Logic
        const lightbox = document.getElementById('lightbox');
        const lbImg = document.getElementById('lb-img');
        const lbCap = document.getElementById('lb-cap');

        function openLightbox(cardElement) {
            const img = cardElement.querySelector('img');
            const title = cardElement.querySelector('.title').innerHTML;
            const meta = cardElement.querySelector('.meta').innerHTML;

            lbImg.src = img.src;
            lbCap.innerHTML = `<strong>${title}</strong><br>${meta}`;
            lightbox.classList.add('open');
        }

        function closeLightbox() {
            lightbox.classList.remove('open');
            lbImg.src = '';
            lbCap.innerHTML = '';
        }

        // Close on background click
        lightbox.addEventListener('click', (e) => {
            if (e.target === lightbox) {
                closeLightbox();
            }
        });
    </script>
</body>
</html>
```
