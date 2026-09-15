# -*- coding: utf-8 -*-
import datetime as dt, sys, importlib
import openpyxl
import evalxl
evalxl.TODAY = dt.date(2026, 9, 15)
sys.path.insert(0, "/home/user/nestro/mtr_schedule")
import build_mtr_schedule as B   # переиспользуем модель-эталон

PATH = "/home/user/nestro/mtr_schedule/График_закупки_и_доставки_МТР_крепление_ЮГ-1_ЮГ-2_ЮГ-3.xlsx"
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

# --- 1. Все формулы книги должны вычисляться без ошибок -----------------------
bad_eval = 0
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith("="):
                try:
                    ev.cell(ws.title, c.coordinate)
                except Exception as e:
                    bad_eval += 1
                    if bad_eval <= 8:
                        errs.append(f"ОШИБКА ВЫЧИСЛЕНИЯ {ws.title}!{c.coordinate} = {c.value} -> {e}")
print(f"формул в книге проверено, ошибок вычисления: {bad_eval}")

# --- 2. Справочник ------------------------------------------------------------
for code, name, dur in B.CATEGORIES:
    col = openpyxl.utils.get_column_letter(B.CAT_COL[code])
    eq(f"Справочник итого {code}", ev.cell("Справочник", f"{col}{B.TOT_R}"), sum(dur))
for (well, op), r in B.OP_ROW.items():
    eq(f"потребность {well}/{op}",
       ev.cell("Справочник", f"E{r}"),
       ser(B.OP_DATE[(well, op)] - dt.timedelta(days=B.NEED_LEAD)))

# --- 3. Листы скважин ---------------------------------------------------------
for well in B.WELLS:
    for idx, (name, uom, cat, op, qty, note) in enumerate(B.NOMENCLATURE):
        m = B.model[(well, idx)]
        h = B.well_item_row[(well, idx)]
        tag = f"{well}/{name}"
        eq(f"{tag} ед.изм", ev.cell(well, f"C{h}"), uom)
        eq(f"{tag} кол-во", ev.cell(well, f"D{h}"), qty)
        eq(f"{tag} цикл сут", ev.cell(well, f"E{h}"), m["total"])
        eq(f"{tag} потребность", ev.cell(well, f"H{h}"), ser(m["need"]))
        eq(f"{tag} требуемый старт", ev.cell(well, f"I{h}"), ser(m["req_start"]))
        eq(f"{tag} старт план", ev.cell(well, f"J{h}"), ser(m["planned"]))
        eq(f"{tag} прогноз", ev.cell(well, f"K{h}"), ser(m["forecast"]))
        eq(f"{tag} запас", ev.cell(well, f"L{h}"), m["slack"])
        eq(f"{tag} статус", ev.cell(well, f"M{h}"), m["status"])
        # цепочка этапов: без разрывов, старт = план, финиш = прогноз
        prev_end = ser(m["planned"])
        for k in range(len(B.STAGES)):
            r = h + 1 + k
            st = ev.cell(well, f"F{r}"); en = ev.cell(well, f"G{r}")
            d = ev.cell(well, f"E{r}")
            eq(f"{tag} этап{k+1} начало=конец пред.", st, prev_end)
            eq(f"{tag} этап{k+1} длительность", d, B.CAT_DUR[cat][k])
            eq(f"{tag} этап{k+1} конец", en, st + d)
            prev_end = en
        eq(f"{tag} финиш цепочки = прогноз", prev_end, ser(m["forecast"]))

# --- 4. Сводный график --------------------------------------------------------
gs = wb["СВОДНЫЙ ГРАФИК"]
for (well, idx), r in B.gantt_rows.items():
    m = B.model[(well, idx)]
    tag = f"Гант {well}/{m['name']}"
    eq(f"{tag} наим", ev.cell("СВОДНЫЙ ГРАФИК", f"C{r}"), m["name"])
    eq(f"{tag} кол-во", ev.cell("СВОДНЫЙ ГРАФИК", f"E{r}"), m["qty"])
    eq(f"{tag} старт", ev.cell("СВОДНЫЙ ГРАФИК", f"F{r}"), ser(m["planned"]))
    eq(f"{tag} оконч.изгот", ev.cell("СВОДНЫЙ ГРАФИК", f"G{r}"),
       ser(m["planned"] + dt.timedelta(days=sum(B.CAT_DUR[m["cat"]][:3]))))
    eq(f"{tag} прогноз", ev.cell("СВОДНЫЙ ГРАФИК", f"H{r}"), ser(m["forecast"]))
    eq(f"{tag} потребность", ev.cell("СВОДНЫЙ ГРАФИК", f"I{r}"), ser(m["need"]))
    eq(f"{tag} запас", ev.cell("СВОДНЫЙ ГРАФИК", f"J{r}"), m["slack"])
    eq(f"{tag} статус", ev.cell("СВОДНЫЙ ГРАФИК", f"K{r}"), m["status"])
    # весь интервал бара должен помещаться в шкалу
    if not (B.GANTT_FROM <= m["planned"] and m["forecast"] <= B.GANTT_TO and m["need"] <= B.GANTT_TO):
        errs.append(f"{tag}: выходит за шкалу {m['planned']}..{max(m['forecast'],m['need'])}")

# --- 5. Шкала времени ---------------------------------------------------------
dates = [gs.cell(5, c).value for c in range(B.T0, B.TLAST + 1)]
eq("шкала: первая дата", dates[0], dt.datetime(2026, 9, 1))
eq("шкала: последняя дата", dates[-1], dt.datetime(2027, 6, 30))
eq("шкала: длина", len(dates), (B.GANTT_TO - B.GANTT_FROM).days + 1)
gaps = [i for i in range(1, len(dates)) if (dates[i] - dates[i-1]).days != 1]
eq("шкала: непрерывность", gaps, [])
today_cols = [c for c in range(B.T0, B.TLAST + 1) if gs.cell(5, c).value == dt.datetime(2026, 9, 15)]
eq("шкала: текущая дата присутствует ровно 1 раз", len(today_cols), 1)

# --- 6. Сводная потребность ---------------------------------------------------
ss = wb["Сводная потребность"]
for idx, (name, uom, cat, op, qty, note) in enumerate(B.NOMENCLATURE):
    r = 5 + idx
    slacks = [B.model[(w, idx)]["slack"] for w in B.WELLS]
    needs = [B.model[(w, idx)]["need"] for w in B.WELLS]
    worst = "СРЫВ ГРАФИКА" if min(slacks) < 0 else ("РИСК" if min(slacks) < B.RISK_THRESHOLD else "В ГРАФИКЕ")
    eq(f"Сводн. {name} наим", ev.cell("Сводная потребность", f"B{r}"), name)
    eq(f"Сводн. {name} итого", ev.cell("Сводная потребность", f"G{r}"), qty * 3)
    eq(f"Сводн. {name} цикл", ev.cell("Сводная потребность", f"H{r}"), sum(B.CAT_DUR[cat]))
    eq(f"Сводн. {name} ранняя потребность", ev.cell("Сводная потребность", f"I{r}"), ser(min(needs)))
    eq(f"Сводн. {name} мин.запас", ev.cell("Сводная потребность", f"J{r}"), min(slacks))
    eq(f"Сводн. {name} статус", ev.cell("Сводная потребность", f"K{r}"), worst)

# --- 7. Покрытие: 14 номенклатур на каждой скважине ---------------------------
for well in B.WELLS:
    names = [ev.cell(well, f"B{B.well_item_row[(well, i)]}") for i in range(len(B.NOMENCLATURE))]
    eq(f"{well}: полный перечень", names, [n[0] for n in B.NOMENCLATURE])
eq("всего строк в сводном графике", len(B.gantt_rows), 42)

print(f"\nпроверок: {checks}, расхождений: {len(errs)}")
for e in errs[:40]: print("  !", e)
sys.exit(1 if errs or bad_eval else 0)
