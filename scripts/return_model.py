"""
5-Year Return Model
===================

The deterministic "math" half of the agent. The AI analyst never calculates
anything itself: it chooses two assumptions (five-year revenue growth and an
exit multiple) and this code turns them into a result.

What it does, in plain English:
  1. Holds today's operating margin flat and grows revenue for five years.
  2. Values the company in year five at (operating income x exit multiple).
  3. Adds cash, subtracts long-term debt, divides by shares: a year-five price.
  4. Compares that price with today's price to get an annual return.
  5. Makes the call: Research (at or above the hurdle), Watch (within
     3 points below), or Pass.
  6. Also works backwards: what growth would be needed to clear the hurdle.
  7. Builds a 3x3 sensitivity grid (growth +/- 5 points, multiple +/- 5x).

It was rewritten from the "5-Year Return Model.xlsx" spreadsheet used in the
workshop and checked against it case by case. Comments like "B28" point to the
spreadsheet cell each line reproduces.

Where it runs: inside the "Run the Model (Python)" step of the
"Tool - Return Model" workflow (workflows/tool-return-model.json). n8n passes
in one company at a time. This file is the same code, set up so it can also be
run on its own:  python scripts/return_model.py

Units: money in $ millions, shares in millions, price in $.
"""


YEARS = 5


def year5_return(revenue, cash, debt, shares, price, growth, margin, multiple):
    """Rows 28-33 of the sheet: one scenario -> annual return."""
    revenue5 = revenue * (1 + growth) ** YEARS          # B28 = B9*(1+B23)^5
    op_income5 = revenue5 * margin                       # B29 = B28*B24
    ev5 = op_income5 * multiple                          # B30 = B29*B25
    equity5 = ev5 + cash - debt                          # B31 = B30+B11-B12
    price5 = equity5 / shares if shares else 0           # B32 = IF(B8=0,0,B31/B8)
    annual = (price5 / price) ** (1 / YEARS) - 1 if price5 > 0 else -1   # B33
    return {"revenue5": revenue5, "opIncome5": op_income5, "ev5": ev5,
            "equity5": equity5, "price5": price5, "annualReturn": annual}


def growth_needed(revenue, cash, debt, shares, price, hurdle, margin, multiple):
    """Row 37 reverse check, solved with algebra:
    growth = ((price*(1+hurdle)^5*shares - cash + debt) / multiple / margin / revenue)^(1/5) - 1"""
    if revenue <= 0 or margin <= 0 or multiple <= 0:
        return None
    revenue5_needed = (price * (1 + hurdle) ** YEARS * shares - cash + debt) / multiple / margin
    if revenue5_needed <= 0:
        return -1.0  # cash alone covers the hurdle: any growth clears it
    return (revenue5_needed / revenue) ** (1 / YEARS) - 1


def make_call(annual, hurdle):
    """Research at/above hurdle, Watch within 3 points below, Pass otherwise."""
    if annual is None:
        return "No call"
    if annual >= hurdle:
        return "Research"
    if annual >= hurdle - 0.03:
        return "Watch"
    return "Pass"


def return_grid(revenue, cash, debt, shares, price, growth, margin, multiple,
                growth_step=0.05, multiple_step=5):
    """3x3 grid: growth -/0/+ 5 points (rows) x exit multiple -/0/+ 5x (columns)."""
    growths = [growth - growth_step, growth, growth + growth_step]
    multiples = [max(1, multiple - multiple_step), multiple, multiple + multiple_step]
    rows = []
    for g in growths:
        rows.append([year5_return(revenue, cash, debt, shares, price, g, margin, m)["annualReturn"]
                     for m in multiples])
    return {"growths": growths, "multiples": multiples, "returns": rows}


def pct(x):
    return "n/a" if x is None else ("%.1f%%" % (x * 100))


def grid_text(grid):
    """One line per growth rate, e.g. 'g 10%: 15x 3.1% | 20x 8.2% | 25x 12.0%'."""
    lines = []
    for g, rets in zip(grid["growths"], grid["returns"]):
        cells = ["%gx %s" % (m, pct(r)) for m, r in zip(grid["multiples"], rets)]
        lines.append("g %s: %s" % (pct(g), " | ".join(cells)))
    return "\n".join(lines)


def num(x):
    try:
        return None if x is None or x == "" else float(x)
    except (TypeError, ValueError):
        return None


def r4(x):
    return None if x is None else round(x, 4)


def run_company(c):
    """One company from 'Hand Off to Python' -> the model's results for that company."""
    revenue, op_income = num(c.get("revenueM")), num(c.get("opIncomeM"))
    cash, debt = num(c.get("cashM")) or 0.0, num(c.get("debtM")) or 0.0
    shares, price = num(c.get("sharesM")), num(c.get("price"))
    hurdle = num(c.get("hurdle"))
    growth, multiple = num(c.get("growth")), num(c.get("exitMultiple"))
    notes = [c["flags"]] if c.get("flags") else []

    row = {"ticker": c.get("ticker"), "company": c.get("company"), "fiscalYearEnd": c.get("fiscalYearEnd"),
           "price": price, "sharesM": shares, "revenueM": revenue, "opIncomeM": op_income,
           "cashM": cash, "debtM": debt, "currentMargin": None, "hurdle": hurdle,
           "growth": growth, "exitMultiple": multiple, "sharePriceYear5": None, "annualReturn": None,
           "call": "No call", "growthNeeded": None, "debtToOpIncome": None, "grid": None}

    if revenue and revenue > 0 and op_income is not None:
        row["currentMargin"] = r4(op_income / revenue)
    if op_income and op_income > 0:
        row["debtToOpIncome"] = r4(debt / op_income)

    inputs_ok = all(v is not None and v > 0 for v in [revenue, shares, price]) and hurdle is not None
    if not inputs_ok or op_income is None:
        notes.append("model not run: missing company data")
    elif op_income <= 0:
        notes.append("model not run: operating loss, current margin not meaningful")
    elif growth is None or multiple is None:
        notes.append("model not run: no growth or exit multiple given")
    else:
        margin = op_income / revenue  # current operating margin (sheet B15)
        result = year5_return(revenue, cash, debt, shares, price, growth, margin, multiple)
        row["sharePriceYear5"] = round(result["price5"], 2)
        row["annualReturn"] = r4(result["annualReturn"])
        row["call"] = make_call(result["annualReturn"], hurdle)
        row["growthNeeded"] = r4(growth_needed(revenue, cash, debt, shares, price, hurdle, margin, multiple))
        row["grid"] = grid_text(return_grid(revenue, cash, debt, shares, price, growth, margin, multiple))

    row["notes"] = " | ".join(notes)
    return row


# ---------------------------------------------------------------------------
# Run on its own: one worked example.
# Inputs are NVIDIA's figures from a November 2026 run of the agent, with the
# analyst's assumptions of 16% growth and a 25x exit multiple.
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    example = {
        "ticker": "NVDA", "company": "NVIDIA Corp", "price": 173.73,
        "sharesM": 24300, "revenueM": 215938, "opIncomeM": 130387,
        "cashM": 10605, "debtM": 8468, "hurdle": 0.12,
        "growth": 0.16, "exitMultiple": 25,
    }
    result = run_company(example)
    print("Annual return:", pct(result["annualReturn"]))
    print("Call:", result["call"])
    print("Growth needed to clear the hurdle:", pct(result["growthNeeded"]))
    print("Debt / operating income:", result["debtToOpIncome"])
    print("Sensitivity grid:")
    print(result["grid"])
