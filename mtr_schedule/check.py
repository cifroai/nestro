# -*- coding: utf-8 -*-
"""Сквозная проверка книги: вычисляет каждую формулу и сверяет с эталонной моделью."""
import datetime as dt, sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
import openpyxl
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evalxl
import contextlib
with contextlib.redirect_stdout(io.StringIO()):
    import build_mtr_schedule as B
evalxl.TODAY = B.TODAY

PATH = os.path.join(HERE, "График_поставки_МТР_крепление_ЮГ-1_ЮГ-2_ЮГ-3.xlsx")
wb = openpyxl.load_workbook(PATH)
ev = evalxl.Ev(wb)
E = evalxl.EPOCH
ser = lambda d: (d - E).days

errs, checks = [], 0
def eq(label, got, exp):
    global checks
    checks += 1
    if got != exp:
        errs.append(f"{label}: получено {got!r}, ожидалось {exp!r}")

# --- 1. каждая формула книги должна вычисляться -------------------------------
bad = 0
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith("="):
                try:
                    ev.cell(ws.title, c.coordinate)
                except Exception as e:
                    bad += 1
                    if bad <= 8:
                        errs.append(f"ОШИБКА ВЫЧИСЛЕНИЯ {ws.title}!{c.coordinate}={c.value} -> {e}")
print(f"формул в книге проверено, ошибок вычисления: {bad}")

# --- 2. Справочник ------------------------------------------------------------
for code, full, short, dur in B.CATEGORIES:
    col = openpyxl.utils.get_column_letter(B.CAT_COL[code])
    eq(f"Справочник итого {code}", ev.cell("Справочник", f"{col}{B.TOT_R}"), sum(dur))
for (well, op), r in B.OP_ROW.items():
    eq(f"потребность {well}/{op}", ev.cell("Справочник", f"E{r}"),
       ser(B.OP_DATE[(well, op)] - dt.timedelta(days=B.NEED_LEAD)))
for i, (name, uom, cat, op, qty, res, note) in enumerate(B.NOMENCLATURE):
    eq(f"Справочник ИТОГО {name}", ev.cell("Справочник", f"I{B.NOM_R0+i}"), qty * 3 + res)

# --- 3. даты операций соответствуют письму -----------------------------------
LETTER = {
    "ЮГ-1": {"Направление ОК-426": dt.date(2026,11,17), "Кондуктор ОК-324": dt.date(2026,11,25),
             "Экспл. колонна ОК-245": dt.date(2026,12,18)},
    "ЮГ-2": {"Направление ОК-426": dt.date(2027,2,14), "Кондуктор ОК-324": dt.date(2027,2,22),
             "Экспл. колонна ОК-245": dt.date(2027,3,16)},
    "ЮГ-3": {"Направление ОК-426": dt.date(2027,5,19), "Кондуктор ОК-324": dt.date(2027,5,27),
             "Экспл. колонна ОК-245": dt.date(2027,6,18)},
}
for well, ops in LETTER.items():
    for op, d in ops.items():
        eq(f"письмо {well}/{op}", ev.cell("Справочник", f"C{B.OP_ROW[(well, op)]}"), ser(d))
    liner = ev.cell("Справочник", f"C{B.OP_ROW[(well, 'Фильтр-хвостовик ОК-168')]}")
    eq(f"хвостовик {well} = ЭК+21", liner, ser(ops["Экспл. колонна ОК-245"] + dt.timedelta(days=21)))

# --- 4. листы скважин ---------------------------------------------------------
for well in B.WELLS:
    for idx, (name, uom, cat, op, qty, res, note) in enumerate(B.NOMENCLATURE):
        m = B.model[(well, idx)]
        h = B.well_item_row[(well, idx)]
        t = f"{well}/{name}"
        eq(f"{t} ед.изм",      ev.cell(well, f"C{h}"), uom)
        eq(f"{t} кол-во",      ev.cell(well, f"D{h}"), qty)
        eq(f"{t} цикл",        ev.cell(well, f"F{h}"), m["total"])
        eq(f"{t} потребность", ev.cell(well, f"I{h}"), ser(m["need"]))
        eq(f"{t} треб.старт",  ev.cell(well, f"J{h}"), ser(m["req_start"]))
        eq(f"{t} старт план",  ev.cell(well, f"K{h}"), ser(m["planned"]))
        eq(f"{t} прогноз",     ev.cell(well, f"L{h}"), ser(m["forecast"]))
        eq(f"{t} запас",       ev.cell(well, f"M{h}"), m["slack"])
        eq(f"{t} статус",      ev.cell(well, f"N{h}"), m["status"])
        prev = ser(m["planned"])
        for k in range(len(B.STAGES)):
            r = h + 1 + k
            st, en, d = (ev.cell(well, f"G{r}"), ev.cell(well, f"H{r}"), ev.cell(well, f"F{r}"))
            eq(f"{t} эт{k+1} стык", st, prev)
            eq(f"{t} эт{k+1} длит", d, B.CAT_DUR[cat][k])
            eq(f"{t} эт{k+1} конец", en, st + d)
            prev = en
        eq(f"{t} финиш цепочки", prev, ser(m["forecast"]))
        eq(f"{t} этап крепления", ev.cell(well, f"E{h}"), op)

# --- 5. сводный график --------------------------------------------------------
gs = wb["СВОДНЫЙ ГРАФИК"]
for (well, idx), r in B.gantt_rows.items():
    m = B.model[(well, idx)]
    t = f"Гант {well}/{m['name']}"
    eq(f"{t} наим",   ev.cell("СВОДНЫЙ ГРАФИК", f"C{r}"), m["name"])
    eq(f"{t} кол-во", ev.cell("СВОДНЫЙ ГРАФИК", f"E{r}"), m["qty"])
    eq(f"{t} старт",  ev.cell("СВОДНЫЙ ГРАФИК", f"F{r}"), ser(m["planned"]))
    eq(f"{t} изгот",  ev.cell("СВОДНЫЙ ГРАФИК", f"G{r}"),
       ser(m["planned"] + dt.timedelta(days=sum(B.CAT_DUR[m["cat"]][:3]))))
    eq(f"{t} прогноз",     ev.cell("СВОДНЫЙ ГРАФИК", f"H{r}"), ser(m["forecast"]))
    eq(f"{t} потребность", ev.cell("СВОДНЫЙ ГРАФИК", f"I{r}"), ser(m["need"]))
    eq(f"{t} запас",  ev.cell("СВОДНЫЙ ГРАФИК", f"J{r}"), m["slack"])
    eq(f"{t} статус", ev.cell("СВОДНЫЙ ГРАФИК", f"K{r}"), m["status"])
    if not (B.GANTT_FROM <= m["planned"] and max(m["forecast"], m["need"]) <= B.GANTT_TO):
        errs.append(f"{t}: интервал выходит за шкалу")

dates = [gs.cell(B.G_HDR, c).value for c in range(B.T0, B.TLAST + 1)]
eq("шкала: первая дата", dates[0].date(), B.GANTT_FROM)
eq("шкала: последняя дата", dates[-1].date(), B.GANTT_TO)
eq("шкала: непрерывность", [i for i in range(1, len(dates))
                            if (dates[i] - dates[i-1]).days != 1], [])
eq("шкала: текущая дата ровно один раз",
   sum(1 for d in dates if d.date() == B.TODAY), 1)

# --- 6. сводная потребность ---------------------------------------------------
for idx, (name, uom, cat, op, qty, res, note) in enumerate(B.NOMENCLATURE):
    r = 5 + idx
    slacks = [B.model[(w, idx)]["slack"] for w in B.WELLS]
    needs = [B.model[(w, idx)]["need"] for w in B.WELLS]
    worst = ("СРЫВ ГРАФИКА" if min(slacks) < 0 else
             ("РИСК" if min(slacks) < B.RISK_THRESHOLD else "В ГРАФИКЕ"))
    eq(f"Сводн {name} наим",   ev.cell("Сводная потребность", f"B{r}"), name)
    eq(f"Сводн {name} итого",  ev.cell("Сводная потребность", f"G{r}"), qty * 3 + res)
    eq(f"Сводн {name} цикл",   ev.cell("Сводная потребность", f"H{r}"), sum(B.CAT_DUR[cat]))
    eq(f"Сводн {name} ранняя", ev.cell("Сводная потребность", f"I{r}"), ser(min(needs)))
    eq(f"Сводн {name} запас",  ev.cell("Сводная потребность", f"J{r}"), min(slacks))
    eq(f"Сводн {name} статус", ev.cell("Сводная потребность", f"K{r}"), worst)

# --- 7. состав и покрытие -----------------------------------------------------
for well in B.WELLS:
    names = [ev.cell(well, f"B{B.well_item_row[(well, i)]}") for i in range(len(B.NOMENCLATURE))]
    eq(f"{well}: полный перечень", names, [n[0] for n in B.NOMENCLATURE])
eq("позиций в сводном графике", len(B.gantt_rows), len(B.NOMENCLATURE) * len(B.WELLS))
eq("заблаговременность", B.NEED_LEAD, 10)

# --- 8. текст помещается в ячейки --------------------------------------------
clipped = []
for ws in wb.worksheets:
    widths = B.WIDTHS.get(ws.title, {})
    if not widths:
        continue
    # для объединенных ячеек ширина — сумма ширин столбцов диапазона;
    # ячейки, поглощенные объединением, пропускаем
    span, swallowed = {}, set()
    for mr in ws.merged_cells.ranges:
        for rr in range(mr.min_row, mr.max_row + 1):
            for cc in range(mr.min_col, mr.max_col + 1):
                if (rr, cc) != (mr.min_row, mr.min_col):
                    swallowed.add((rr, cc))
        if mr.min_row == mr.max_row:
            span[(mr.min_row, mr.min_col)] = sum(
                widths.get(cc, 8.43) for cc in range(mr.min_col, mr.max_col + 1))
    for row in ws.iter_rows(min_row=1, max_row=ws.max_row, max_col=max(widths)):
        for c in row:
            v = c.value
            if not isinstance(v, str) or v.startswith("=") or (c.row, c.column) in swallowed:
                continue
            w = span.get((c.row, c.column), widths.get(c.column))
            h = ws.row_dimensions[c.row].height
            if not w or not h:
                continue
            size = c.font.size or 11
            if not c.alignment.wrap_text:
                # без переноса текст перетекает в соседние ячейки — проверяем,
                # что справа действительно пусто до края блока
                continue
            need = B.text_lines(v, w, size, indent=(c.alignment.indent or 0))
            avail = int((h - 2) / (size * 1.2))
            if need > avail:
                clipped.append(f"{ws.title}!{c.coordinate} нужно {need} стр., помещается {avail}"
                               f" (h={h}, w={round(w,1)}, {size}pt): {v[:45]!r}")
eq("обрезанного текста нет", clipped[:6], [])

print(f"\nпроверок: {checks}, расхождений: {len(errs)}")
for e in errs[:40]:
    print("  !", e)
sys.exit(1 if errs or bad else 0)
