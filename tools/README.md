# Regenerating the manufacturer spec table

`designer/engines/unit-specs.mjs` is generated from MM Electrical's
"NEW STOCK UPDATE — TECH DATA SHEETS" workbook. When MM reissue it:

```bash
python3 tools/tech-sheets-parse.py     # workbook -> specs.json   (raw, per sheet)
python3 tools/tech-sheets-build.py     # specs.json -> unitspecs.json (normalised + validated)
```

Both expect `stock.xlsx` in the working directory. The build step prints every
row it drops and why.

Rows are dropped, never corrected. Each brand's sheet carries several sections
with different column orders, so a misaligned row is a real risk, and the
engines already handle a missing specification — they report SPECIFICATION DATA
REQUIRED. A wrong one they cannot handle.

Checks applied:

- capacity between 2 and 120 kW
- airflow between 30 and 110 L/s per kW (what a ducted fan coil actually runs at)
- available static between 50 and 350 Pa
- a return spigot diameter that exists as flex (200–500 mm), 1–4 of them

Do not hand-edit `unit-specs.mjs` — the next reissue would overwrite it.
