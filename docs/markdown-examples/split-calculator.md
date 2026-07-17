Here is a complete, well-styled, and interactive tip and split calculator. Save this code as an `.html` file and open it in any web browser to use it.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tip & Split Calculator</title>
    <style>
        :root {
            --bg-color: #f3f4f6;
            --card-bg: #ffffff;
            --primary: #10b981;
            --text-dark: #1f2937;
            --text-light: #6b7280;
            --border: #e5e7eb;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            color: var(--text-dark);
        }
        .calculator {
            background: var(--card-bg);
            padding: 2rem;
            border-radius: 1rem;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            width: 100%;
            max-width: 350px;
        }
        h2 {
            margin-top: 0;
            margin-bottom: 1.5rem;
            text-align: center;
            font-size: 1.25rem;
            color: var(--text-dark);
        }
        .input-group {
            margin-bottom: 1rem;
            display: flex;
            flex-direction: column;
        }
        .input-group label {
            font-size: 0.875rem;
            font-weight: 500;
            margin-bottom: 0.5rem;
            color: var(--text-light);
        }
        .input-group input {
            padding: 0.75rem;
            font-size: 1rem;
            border: 1px solid var(--border);
            border-radius: 0.5rem;
            transition: border-color 0.2s;
        }
        .input-group input:focus {
            outline: none;
            border-color: var(--primary);
        }
        .input-wrapper {
            position: relative;
            display: flex;
            align-items: center;
        }
        .input-wrapper span {
            position: absolute;
            left: 0.75rem;
            color: var(--text-light);
        }
        .input-wrapper input {
            width: 100%;
            padding-left: 1.75rem;
            box-sizing: border-box;
        }
        .percent-wrapper span {
            left: auto;
            right: 0.75rem;
        }
        .percent-wrapper input {
            padding-left: 0.75rem;
            padding-right: 1.75rem;
        }
        .results {
            margin-top: 1.5rem;
            padding-top: 1.5rem;
            border-top: 1px dashed var(--border);
        }
        .result-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }
        .result-label {
            font-size: 0.875rem;
            color: var(--text-light);
        }
        .result-value {
            font-weight: 600;
            font-size: 1.125rem;
        }
        .total-row {
            background: var(--primary);
            color: white;
            padding: 1rem;
            border-radius: 0.5rem;
            margin-top: 1rem;
            margin-bottom: 0;
        }
        .total-row .result-label {
            color: rgba(255, 255, 255, 0.9);
            font-weight: 500;
        }
        .total-row .result-value {
            font-size: 1.5rem;
        }
    </style>
</head>
<body>

<div class="calculator">
    <h2>Tip & Split Calculator</h2>

    <div class="input-group">
        <label for="bill">Bill Amount</label>
        <div class="input-wrapper">
            <span>€</span>
            <input type="number" id="bill" value="186.50" min="0" step="0.01">
        </div>
    </div>

    <div class="input-group">
        <label for="tip">Tip Percentage</label>
        <div class="input-wrapper percent-wrapper">
            <input type="number" id="tip" value="15" min="0" step="1">
            <span>%</span>
        </div>
    </div>

    <div class="input-group">
        <label for="people">Number of People</label>
        <input type="number" id="people" value="4" min="1" step="1">
    </div>

    <div class="results">
        <div class="result-row">
            <span class="result-label">Tip Amount</span>
            <span class="result-value" id="tipAmount">€0.00</span>
        </div>
        <div class="result-row">
            <span class="result-label">Total Bill</span>
            <span class="result-value" id="totalBill">€0.00</span>
        </div>
        <div class="result-row total-row">
            <span class="result-label">Per Person</span>
            <span class="result-value" id="perPerson">€0.00</span>
        </div>
    </div>
</div>

<script>
    const inputs = ['bill', 'tip', 'people'];
    const elements = {
        bill: document.getElementById('bill'),
        tip: document.getElementById('tip'),
        people: document.getElementById('people'),
        tipAmount: document.getElementById('tipAmount'),
        totalBill: document.getElementById('totalBill'),
        perPerson: document.getElementById('perPerson')
    };

    function calculate() {
        // Parse inputs
        const bill = parseFloat(elements.bill.value) || 0;
        const tipPercent = parseFloat(elements.tip.value) || 0;
        const people = parseInt(elements.people.value) || 1;

        // Ensure at least 1 person to prevent division by zero
        const validPeople = Math.max(1, people);

        // Calculations
        const tipValue = bill * (tipPercent / 100);
        const totalValue = bill + tipValue;
        const perPersonValue = totalValue / validPeople;

        // Formatting function
        const formatEuro = (amount) => '€' + amount.toFixed(2);

        // Update DOM
        elements.tipAmount.textContent = formatEuro(tipValue);
        elements.totalBill.textContent = formatEuro(totalValue);
        elements.perPerson.textContent = formatEuro(perPersonValue);
    }

    // Add event listeners for live updates
    inputs.forEach(id => {
        document.getElementById(id).addEventListener('input', calculate);
    });

    // Initial calculation on page load
    calculate();
</script>

</body>
</html>
```
