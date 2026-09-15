# -*- coding: utf-8 -*-
"""
Сводный график поставки МТР для крепления скважин ЮГ-1, ЮГ-2, ЮГ-3
(Южный участок Мутновского месторождения).

Редакция 2: приняты правки Заказчика в листе «Справочник» (наименования этапов,
заблаговременность 10 сут, расширенная до 16 позиций номенклатура, объемы,
обоснования, резерв «+1 на 3 скв.»). Даты операций по креплению — по письму
руководителя направления отдела бурения скважин от 15.09.2026.

Логистическая схема — из исходного файла «График доставки цемента на скв. ГЕО-12»:
завод-изготовитель -> ж/д до Владивостока -> морской переход до
Петропавловска-Камчатского -> доставка с порта до скважины.
"""
import datetime as dt

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.formatting.rule import Rule
from openpyxl.styles.differential import DifferentialStyle

# ============================================================================
# ИСХОДНЫЕ ДАННЫЕ
# ============================================================================
TITLE = ("СВОДНЫЙ ГРАФИК ПОСТАВКИ МТР ДЛЯ КРЕПЛЕНИЯ СКВАЖИН "
         "НА ЮЖНОМ УЧАСТКЕ МУТНОВСКОГО МЕСТОРОЖДЕНИЯ")

TODAY = dt.date(2026, 9, 15)              # дата формирования графика
PROCUREMENT_READY = dt.date(2026, 9, 20)  # ранее этой даты заказ разместить невозможно
TARGET_BUFFER = 14                        # плановый резерв к требуемому сроку, сут
RISK_THRESHOLD = 14                       # запас < 14 сут -> РИСК
NEED_LEAD = 10                            # МТР на скважине за 10 сут до операции

DATE_FMT = "DD.MM.YYYY"

# --- Этапы поставки (редакция Заказчика) -------------------------------------
STAGES = [
    "Согласование спецификации",
    "Изготовление на заводе-изготовителе",
    "Подготовка к отгрузке: растаривание/затарка в МКР, пакетирование, маркировка",
    "Перевозка на контейнерный терминал (затарка в контейнеры, погрузо-разгрузочные работы)",
    "Перевозка ж/д транспортом (завод-изготовитель — ст. Владивосток)",
    "Перевалка во Владивостоке на морское судно (в т.ч. ожидание судна)",
    "Морской переход п.Владивосток — п.Петропавловск-Камчатский",
    "Доставка с порта Петропавловск-Камчатский до скважины "
    "(в т.ч. ожидание и погрузо-разгрузочные работы)",
]

# --- Категории МТР: (код, полное имя, краткое имя, длительности этапов) ------
CATEGORIES = [
    ("CEM",  "Тампонажные материалы (цементы, смеси)", "Тампонажные материалы",
     [10, 3, 2, 2, 14, 2, 7, 4]),
    ("CHEM", "Химреагенты (замедлитель)", "Химреагенты",
     [10, 5, 1, 1, 14, 2, 7, 4]),
    ("OK",   "Трубы обсадные", "Трубы обсадные",
     [14, 35, 2, 3, 18, 3, 7, 5]),
    ("TO",   "Технологическая оснастка", "Технологическая оснастка",
     [10, 25, 2, 2, 16, 2, 7, 4]),
    ("SPEC", "Спецоборудование (пакер, переводник)", "Спецоборудование",
     [14, 60, 2, 2, 16, 2, 7, 4]),
]
CAT_COL = {c[0]: 3 + i for i, c in enumerate(CATEGORIES)}       # C..G
CAT_FULL = {c[0]: c[1] for c in CATEGORIES}
CAT_SHORT = {c[0]: c[2] for c in CATEGORIES}
CAT_DUR = {c[0]: c[3] for c in CATEGORIES}

# --- Программа крепления: даты по письму от 15.09.2026 -----------------------
# Направление / кондуктор / эксплуатационная колонна — по письму.
# Фильтр-хвостовик ОК-168 в письме не указан: принят +21 сут к эксплуатационной
# колонне (интервал, заданный Заказчиком по ЮГ-1: 18.12.2026 -> 08.01.2027).
OP_NAMES = ["Направление ОК-426", "Кондуктор ОК-324",
            "Экспл. колонна ОК-245", "Фильтр-хвостовик ОК-168"]
OP_DATES = {
    "ЮГ-1": [dt.date(2026, 11, 17), dt.date(2026, 11, 25),
             dt.date(2026, 12, 18), dt.date(2027, 1, 8)],
    "ЮГ-2": [dt.date(2027, 2, 14), dt.date(2027, 2, 22),
             dt.date(2027, 3, 16), dt.date(2027, 4, 6)],
    "ЮГ-3": [dt.date(2027, 5, 19), dt.date(2027, 5, 27),
             dt.date(2027, 6, 18), dt.date(2027, 7, 9)],
}
WELLS = ["ЮГ-1", "ЮГ-2", "ЮГ-3"]
OPERATIONS = [(w, OP_NAMES[i], OP_DATES[w][i]) for w in WELLS for i in range(4)]
OP_DATE = {(w, o): d for w, o, d in OPERATIONS}
OP_ROW = {}

# --- Номенклатура (редакция Заказчика, 16 позиций) ---------------------------
# (наименование, ед.изм, категория, этап крепления, кол-во на скважину,
#  резерв к ИТОГО, обоснование)
NOMENCLATURE = [
    ("Цемент марки G (направление)", "тн", "CEM", "Направление ОК-426", 10, 0,
     "ПЦТ G HSR; ρ=1,85 г/см3; Расчет: водоцементное отношение - 0,5; кольцевое пространство "
     "590/426 мм; инт. 0-24 м + стакан; к-т каверн. 1,5; резервный запас 15%"),
    ("Цементная смесь термостойкая тяжелая (кондуктор)", "тн", "CEM", "Кондуктор ОК-324", 40, 0,
     "ρ=1,85 г/см3; Расчет: водоцементное отношение - 0,5; кольцевое пространство 393,7/324 мм; "
     "инт. 0-250 м; к-т каверн. 1,5; резервный запас 15%"),
    ("Цементная смесь термостойкая тяжелая (экспл.колонна)", "тн", "CEM", "Экспл. колонна ОК-245", 100, 0,
     "ρ=1,85 г/см3. Нижняя ступень. Расчет: водоцементное отношение - 0,5; кольц. пр-во "
     "295,3/245 мм; инт. 500-1360 м; к-т каверн. 1,5; резервный запас 15%"),
    ("Цементная смесь термостойкая легкая (экспл.колонна)", "тн", "CEM", "Экспл. колонна ОК-245", 35, 0,
     "ρ=1,50 г/см3. Верхняя ступень. Расчет: водоцементное отношение - 0,5; кольц. пр-во "
     "295,3/245 мм; инт. 500-0 м; к-т каверн. 1,5; резервный запас 15%"),
    ("Цементная смесь буферная (все колонны)", "тн", "CEM", "Кондуктор ОК-324", 10, 0,
     "ρ=1,4 г/см3. Цементный буфер: кондуктор ОК-324 4 тн; экспл.колонна ОК-245 4 тн; "
     "резервный запас 20%. Применяется на ОК-324 и ОК-245; срок привязан к наиболее раннему "
     "применению (кондуктор)"),
    ("Замедлитель схватывания цемента", "кг", "CHEM", "Направление ОК-426", 300, 0,
     "Термостойкий замедлитель схватывания 0,14% от массы цемента (525 тн). Поставка единой "
     "партией под все этапы крепления, срок привязан к первой операции крепления"),
    ("Труба обсадная ОК-426", "м", "OK", "Направление ОК-426", 50, 0,
     "Труба обсадная 426х10 мм, гр.пр. Д, резьба ОТТМ. Глубина спуска 24 м + 100% "
     "технологический запас"),
    ("Труба обсадная ОК-324", "м", "OK", "Кондуктор ОК-324", 350, 0,
     "Труба обсадная 324х9,5 мм, гр.пр. Д, резьба ОТТМ. Глубина спуска 250 м + 40% "
     "технологический запас"),
    ("Труба обсадная ОК-245", "м", "OK", "Экспл. колонна ОК-245", 1500, 0,
     "Труба обсадная 245х10 мм, гр.пр. Е, резьба ОТТГ. Глубина спуска 1360 м + 10% "
     "технологический запас"),
    ("Труба фильтр-хвостовик ОК-168", "м", "OK", "Экспл. колонна ОК-245", 1200, 0,
     "Длина фильтр-хвостовика 1100 м + 10% технологический запас. ТРЕБУЕТ УТОЧНЕНИЯ: в исходных "
     "данных типоразмер и группа прочности указаны как для ОК-245 (245х10 мм, гр.пр. Е, ОТТГ)"),
    ("Тех.оснастка (ОК-426)", "компл.", "TO", "Направление ОК-426", 1, 1,
     "Башмак БКМ-426 (1 шт. + 1 шт в резерв на 3 скв.)"),
    ("Тех.оснастка (ОК-324)", "компл.", "TO", "Кондуктор ОК-324", 1, 0,
     "Башмак БКМ-324 (1 шт. + 1 шт в резерв на 3 скв.); ЦКОД-324 (1 шт. + 1 шт в резерв на 3 скв.), "
     "центраторы ЦЦ-324/394 (15 шт), пробка продавочная ПП-324 (1 шт. + 1 шт в резерв на 3 скв.); "
     "цементировочная корзина (1 шт. + 1 шт в резерв на 3 скв.)"),
    ("Тех.оснастка (ОК-245)", "компл.", "TO", "Экспл. колонна ОК-245", 1, 0,
     "Башмак БКМ-245 (1 шт. + 1 шт в резерв на 3 скв.); ЦКОД-245 (2 шт. + 1 шт в резерв на 3 скв.); "
     "центраторы ЦЦ-245/295 (40 шт); пробка продавочная ПП-245 (1 шт. + 1 шт в резерв на 3 скв.); "
     "цементировочная корзина (1 шт. + 1 шт в резерв на 3 скв.)"),
    ("Тех.оснастка (ОК-168)", "компл.", "TO", "Фильтр-хвостовик ОК-168", 1, 1,
     "Башмак БКМ-168 (1 шт. + 1 шт в резерв на 3 скв.)"),
    ("Пакер набухающий термостойкий", "шт", "SPEC", "Фильтр-хвостовик ОК-168", 1, 1,
     "Пакер набухающий в паро-водяной среде; рабочая температура до 250 С. Изоляция интервала "
     "хвостовика"),
    ("Разъединительный переводник СБТ-127/168 (левый/правый)", "шт", "SPEC",
     "Фильтр-хвостовик ОК-168", 1, 1,
     "Разъединитель подвески хвостовика 245/168, термостойкое исполнение "
     "(1 шт. + 1 шт в резерв на 3 скв.)"),
]


# ============================================================================
# СТИЛИ И НОРМАЛИЗАЦИЯ ЯЧЕЕК
# ============================================================================
C_HEADER, C_SUBHEAD, C_ITEM, C_INPUT, C_BAND = "1F4E79", "2E75B6", "D9E2F3", "FFF2CC", "F7F9FC"

F_TITLE = Font(name="Calibri", size=13, bold=True, color="1F4E79")
F_SUB   = Font(name="Calibri", size=9, italic=True, color="595959")
F_HDR   = Font(name="Calibri", size=9, bold=True, color="FFFFFF")
F_ITEM  = Font(name="Calibri", size=10, bold=True, color="1F4E79")
F_BASE  = Font(name="Calibri", size=9)
F_BASE_B= Font(name="Calibri", size=9, bold=True)
F_INPUT = Font(name="Calibri", size=9, bold=True, color="0000C0")
F_NOTE  = Font(name="Calibri", size=8, color="595959")
F_ACT   = Font(name="Calibri", size=8, color="9C0006")

FILL_HDR   = PatternFill("solid", fgColor=C_HEADER)
FILL_SUB   = PatternFill("solid", fgColor=C_SUBHEAD)
FILL_ITEM  = PatternFill("solid", fgColor=C_ITEM)
FILL_INPUT = PatternFill("solid", fgColor=C_INPUT)
FILL_BAND  = PatternFill("solid", fgColor=C_BAND)

_thin = Side(style="thin", color="B4C6E7")
_med  = Side(style="medium", color="1F4E79")
B_ALL  = Border(left=_thin, right=_thin, top=_thin, bottom=_thin)
B_ITEM = Border(left=_med, right=_med, top=_med, bottom=_thin)

A_C  = Alignment(horizontal="center", vertical="center", wrap_text=True)
A_L  = Alignment(horizontal="left",   vertical="center", wrap_text=True, indent=1)
A_LT = Alignment(horizontal="left",   vertical="top",    wrap_text=True, indent=1)

CLR = {
    "В ГРАФИКЕ":    {"line": "00B050", "transport": "A9D08E", "prod": "E2EFDA",
                     "text": "006100", "cell": "C6EFCE"},
    "РИСК":         {"line": "FFC000", "transport": "FFD966", "prod": "FFF2CC",
                     "text": "9C5700", "cell": "FFEB9C"},
    "СРЫВ ГРАФИКА": {"line": "FF0000", "transport": "F4B183", "prod": "FCE4D6",
                     "text": "9C0006", "cell": "FFC7CE"},
}

WIDTHS = {}   # sheet title -> {col_idx: width}

def set_widths(ws, widths):
    """widths: {индекс столбца: ширина}. Запоминается для расчета высоты строк."""
    WIDTHS[ws.title] = dict(widths)
    for ci, w in widths.items():
        ws.column_dimensions[get_column_letter(ci)].width = w

def text_lines(text, width, size=9, indent=1):
    """Сколько строк займет текст в ячейке заданной ширины при переносе по словам."""
    if text is None or text == "":
        return 1
    cap = max(4, int((width - indent) * 11.0 / size) - 1)
    lines, cur = 0, ""
    for word in str(text).split():
        cand = word if not cur else cur + " " + word
        if len(cand) <= cap:
            cur = cand
        else:
            if cur:
                lines += 1
            while len(word) > cap:
                lines += 1
                word = word[cap:]
            cur = word
    return lines + 1 if (cur or lines == 0) else lines

def autofit(ws, row, cols, size=9, minh=17, extra=5, per_line=None):
    """Высота строки по фактическому объему текста — чтобы ничего не обрезалось."""
    w = WIDTHS[ws.title]
    per_line = per_line or (size * 1.35)
    n = 1
    for ci in cols:
        val = ws.cell(row, ci).value
        if isinstance(val, str) and not val.startswith("="):
            n = max(n, text_lines(val, w.get(ci, 10), size))
    ws.row_dimensions[row].height = max(minh, round(n * per_line + extra, 1))

def style_row(ws, row, c1, c2, font=None, fill=None, border=B_ALL, align=A_C):
    for ci in range(c1, c2 + 1):
        c = ws.cell(row, ci)
        if font:   c.font = font
        if fill:   c.fill = fill
        if border: c.border = border
        if align:  c.alignment = align

def page(ws, landscape=True, titles=None):
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = ws.page_margins.right = 0.3
    ws.page_margins.top = ws.page_margins.bottom = 0.4
    ws.page_margins.header = ws.page_margins.footer = 0.2
    if titles:
        ws.print_title_rows = titles

def banner(ws, row, c1, c2, text, size=11):
    cell = ws.cell(row, c1, text)
    ws.merge_cells(start_row=row, start_column=c1, end_row=row, end_column=c2)
    for ci in range(c1, c2 + 1):
        ws.cell(row, ci).fill = FILL_SUB
        ws.cell(row, ci).border = B_ALL
    cell.font = Font(name="Calibri", size=size, bold=True, color="FFFFFF")
    cell.alignment = A_L
    ws.row_dimensions[row].height = 20
    return cell


# ============================================================================
# РАСЧЕТНАЯ МОДЕЛЬ
# ============================================================================
MIT_LONG = {
    "OK":   "Дефицит {n} сут. Закупка со склада готовой продукции завода вместо изготовления "
            "(-35 сут к циклу); при сохранении дефицита — отправка отдельным вагоном без "
            "накопления судовой партии (-6 сут).",
    "TO":   "Дефицит {n} сут. Закупка складской позиции у дистрибьютора вместо изготовления "
            "(-25 сут к циклу); малый вес и объем допускают авиадоставку Владивосток — "
            "Петропавловск-Камчатский (-7 сут).",
    "SPEC": "Дефицит {n} сут. Поставка со склада поставщика вместо изготовления (-60 сут к циклу) "
            "либо авиадоставка Владивосток — Петропавловск-Камчатский (-7 сут).",
    "CEM":  "Дефицит {n} сут. Первоочередное размещение заказа, ускоренная ж/д отправка "
            "без накопления партии (-6 сут).",
    "CHEM": "Дефицит {n} сут. Первоочередное размещение заказа, авиадоставка партии "
            "(малый вес, -7 сут).",
}
MIT_SHORT = {
    "OK": "склад ГП (-35 сут)", "TO": "склад дистрибьютора (-25 сут)",
    "SPEC": "склад поставщика (-60 сут)", "CEM": "ускоренная отправка (-6 сут)",
    "CHEM": "авиадоставка (-7 сут)",
}

model = {}
for well in WELLS:
    for idx, (name, uom, cat, op, qty, res, note) in enumerate(NOMENCLATURE):
        total = sum(CAT_DUR[cat])
        need = OP_DATE[(well, op)] - dt.timedelta(days=NEED_LEAD)
        req_start = need - dt.timedelta(days=total)
        planned = max(PROCUREMENT_READY, req_start - dt.timedelta(days=TARGET_BUFFER))
        forecast = planned + dt.timedelta(days=total)
        slack = (need - forecast).days
        status = "СРЫВ ГРАФИКА" if slack < 0 else ("РИСК" if slack < RISK_THRESHOLD else "В ГРАФИКЕ")
        if status == "СРЫВ ГРАФИКА":
            act = MIT_LONG[cat].format(n=abs(slack))
            act_s = f"Дефицит {abs(slack)} сут: {MIT_SHORT[cat]}"
        elif status == "РИСК":
            act = (f"Запас {slack} сут — ниже норматива {RISK_THRESHOLD} сут. Размещение заказа "
                   f"первым приоритетом, еженедельный контроль хода изготовления и отгрузки.")
            act_s = f"Запас {slack} сут — на контроль"
        else:
            act = act_s = ""
        model[(well, idx)] = dict(name=name, uom=uom, cat=cat, op=op, qty=qty, res=res,
                                  total=total, need=need, req_start=req_start, planned=planned,
                                  forecast=forecast, slack=slack, status=status,
                                  action=act, action_short=act_s)

wb = Workbook()


# ============================================================================
# ЛИСТ 1 — ИНСТРУКЦИЯ
# ============================================================================
ws_i = wb.active
ws_i.title = "Инструкция"
ws_i.sheet_view.showGridLines = False
set_widths(ws_i, {1: 34, 2: 96})

ws_i.cell(1, 1, TITLE).font = F_TITLE
ws_i.merge_cells("A1:B1")
ws_i.cell(1, 1).alignment = A_L
ws_i.row_dimensions[1].height = 34
ws_i.cell(2, 1, f"Редакция 2 от {TODAY.strftime('%d.%m.%Y')}. Приняты правки Заказчика в листе "
                f"«Справочник». Даты операций по креплению — по письму руководителя направления "
                f"отдела бурения скважин от 15.09.2026. Логистическая схема — из графика "
                f"доставки цемента на скв. ГЕО-12.").font = F_SUB
ws_i.merge_cells("A2:B2")
ws_i.cell(2, 1).alignment = A_LT
autofit(ws_i, 2, [1], size=9)
ws_i.row_dimensions[2].height = round(text_lines(ws_i.cell(2, 1).value, 130, 9) * 12 + 5, 1)

r = 3
def head(t):
    global r
    r += 1
    banner(ws_i, r, 1, 2, t)

def row2(k, v):
    global r
    r += 1
    a = ws_i.cell(r, 1, k); a.font = F_BASE_B; a.alignment = A_LT; a.border = B_ALL
    b = ws_i.cell(r, 2, v); b.font = F_BASE;   b.alignment = A_LT; b.border = B_ALL
    autofit(ws_i, r, [1, 2], size=9)

head("СОСТАВ КНИГИ")
row2("Справочник", "Единственное место ввода. Длительности 8 этапов поставки по 5 категориям МТР, "
                   "программа крепления скважин и номенклатура с объемами. Все остальные листы "
                   "считаются формулами от этого листа — правка здесь пересчитывает всю книгу.")
row2("ЮГ-1 / ЮГ-2 / ЮГ-3", "Подробный график по каждой скважине: по каждой номенклатуре — ед.изм., "
                           "кол-во, дата потребности и сроки начала/окончания по каждому из 8 этапов "
                           "закупки и доставки. Этапы сворачиваются группировкой слева.")
row2("СВОДНЫЙ ГРАФИК", f"Диаграмма Ганта по всем {len(NOMENCLATURE)*3} позициям "
                       f"({len(NOMENCLATURE)} номенклатур x 3 скважины) с вертикальной линией по "
                       f"текущей дате. Линия окрашивается по статусу строки: зеленая — в графике, "
                       f"желтая — риск, красная — срыв графика.")
row2("Сводная потребность", "Суммарный объем закупки по номенклатуре на три скважины с учетом "
                           "резерва, самая ранняя дата потребности и худший статус.")

head("ЛОГИКА РАСЧЕТА")
row2("Дата потребности", f"Дата операции по креплению минус {NEED_LEAD} сут (МТР должен быть на "
                         f"скважине заблаговременно). Задается на листе «Справочник», блок 2.")
row2("Требуемая дата старта", "Дата потребности минус суммарная длительность цикла закупки и "
                              "доставки. Крайний срок согласования спецификации и размещения заказа.")
row2("Дата начала (план/факт)", f"Плановая дата размещения заказа. Принята как «требуемая дата "
                                f"старта минус {TARGET_BUFFER} сут резерва», но не ранее "
                                f"{PROCUREMENT_READY.strftime('%d.%m.%Y')} (готовность закупочной "
                                f"процедуры). ЖЕЛТЫЕ ЯЧЕЙКИ — поле ввода: подставьте фактическую "
                                f"дату размещения заказа, книга пересчитается.")
row2("Прогноз поставки на скважину", "Дата начала (план/факт) плюс длительности всех 8 этапов "
                                     "последовательно.")
row2("Запас, сут", "Дата потребности минус прогноз поставки. Отрицательное значение — опоздание "
                   "относительно срока крепления.")

head("ЛЕГЕНДА СТАТУСОВ")
for st, txt in [("В ГРАФИКЕ", f"Запас {RISK_THRESHOLD} сут и более. Поставка обеспечивает срок крепления."),
                ("РИСК", f"Запас от 0 до {RISK_THRESHOLD-1} сут. Нормативный резерв времени исчерпан, "
                         f"любая задержка ведет к срыву."),
                ("СРЫВ ГРАФИКА", "Запас меньше нуля. Прогнозная поставка позже даты потребности — "
                                 "требуются компенсирующие мероприятия.")]:
    r += 1
    a = ws_i.cell(r, 1, st)
    a.font = Font(name="Calibri", size=9, bold=True, color=CLR[st]["text"])
    a.fill = PatternFill("solid", fgColor=CLR[st]["cell"]); a.alignment = A_C; a.border = B_ALL
    b = ws_i.cell(r, 2, txt); b.font = F_BASE; b.alignment = A_LT; b.border = B_ALL
    autofit(ws_i, r, [2], size=9)

head("ИСТОЧНИКИ ИСХОДНЫХ ДАННЫХ")
row2("Даты операций по креплению",
     "Направление, кондуктор и эксплуатационная колонна по ЮГ-1, ЮГ-2, ЮГ-3 — по письму "
     "руководителя направления отдела бурения скважин от 15.09.2026 (блок 2 листа «Справочник», "
     "столбец «Дата операции по графику»).")
row2("Фильтр-хвостовик ОК-168",
     "В письме срок спуска фильтр-хвостовика не указан. Принят +21 сут к эксплуатационной колонне — "
     "интервал, заданный Заказчиком по ЮГ-1 (18.12.2026 -> 08.01.2027), распространен на ЮГ-2 и ЮГ-3. "
     "ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ.")
row2("Номенклатура, объемы, обоснования",
     "Приняты по редакции Заказчика без изменений, включая резерв «+1 шт на 3 скважины» "
     "в графе ИТОГО по позициям тех.оснастки ОК-426, ОК-168, пакера и переводника.")
row2("Длительности этапов",
     "Ж/д и морское плечо — по фактическим данным графика доставки цемента на скв. ГЕО-12. "
     "Сроки изготовления — по категориям МТР, блок 1 листа «Справочник».")

head("ВОПРОСЫ, ТРЕБУЮЩИЕ РЕШЕНИЯ ЗАКАЗЧИКА")
row2("Труба фильтр-хвостовик ОК-168",
     "Позиция привязана к этапу «Экспл. колонна ОК-245» — как указано в исходных данных. Если труба "
     "требуется к спуску фильтр-хвостовика, срок потребности сдвигается на 21 сут вправо и запас "
     "увеличивается. Кроме того, в обосновании объема указан типоразмер ОК-245 (245х10 мм, гр.пр. Е, "
     "ОТТГ) — вероятно, требуется типоразмер 168 мм.")
row2("Позиции со статусом СРЫВ ГРАФИКА",
     "По скважине ЮГ-1 крайний срок размещения заказа по ряду позиций с длинным циклом изготовления "
     "уже прошел относительно даты формирования графика. Компенсирующие мероприятия указаны в "
     "столбце «Примечание / компенсирующие мероприятия» на листе скважины и в сводном графике. "
     "Альтернатива — сдвиг сроков крепления ЮГ-1 вправо.")
row2("Цементная смесь буферная",
     "Применяется на ОК-324 и ОК-245. Срок потребности привязан к наиболее раннему применению — "
     "кондуктору ОК-324, поставка единой партией.")

ws_i.freeze_panes = "A4"
page(ws_i, landscape=False)


# ============================================================================
# ЛИСТ 2 — СПРАВОЧНИК
# ============================================================================
ws_r = wb.create_sheet("Справочник")
ws_r.sheet_view.showGridLines = False
set_widths(ws_r, {1: 5, 2: 44, 3: 15, 4: 15, 5: 16, 6: 13, 7: 13, 8: 13, 9: 13, 10: 58})

ws_r.cell(1, 1, "СПРАВОЧНИК ИСХОДНЫХ ДАННЫХ").font = F_TITLE
ws_r.row_dimensions[1].height = 22
ws_r.cell(2, 1, "Единственное место ввода: правка желтых ячеек пересчитывает листы ЮГ-1, ЮГ-2, "
                "ЮГ-3, сводный график и сводную потребность.").font = F_SUB
ws_r.merge_cells("A2:J2")
ws_r.cell(2, 1).alignment = A_L
ws_r.row_dimensions[2].height = 15

# --- Блок 1
R1 = 4
banner(ws_r, R1, 1, 10, "1. ДЛИТЕЛЬНОСТЬ ЭТАПОВ ЗАКУПКИ И ДОСТАВКИ ПО КАТЕГОРИЯМ МТР, суток")
HDR1 = R1 + 1
ws_r.cell(HDR1, 1, "№"); ws_r.cell(HDR1, 2, "Наименование этапа")
for code, full, short, _ in CATEGORIES:
    ws_r.cell(HDR1, CAT_COL[code], full)
style_row(ws_r, HDR1, 1, 7, F_HDR, FILL_HDR)
autofit(ws_r, HDR1, [2] + [CAT_COL[c[0]] for c in CATEGORIES], size=9, minh=42)

STAGE_R0 = HDR1 + 1
for i, st in enumerate(STAGES):
    rr = STAGE_R0 + i
    ws_r.cell(rr, 1, i + 1)
    ws_r.cell(rr, 2, st)
    for code, _, _, dur in CATEGORIES:
        ws_r.cell(rr, CAT_COL[code], dur[i])
    style_row(ws_r, rr, 1, 7, F_BASE, FILL_BAND if i % 2 == 0 else None)
    ws_r.cell(rr, 2).alignment = A_L
    for code, _, _, _ in CATEGORIES:
        c = ws_r.cell(rr, CAT_COL[code]); c.fill = FILL_INPUT; c.font = F_INPUT
    autofit(ws_r, rr, [2], size=9, minh=22)

TOT_R = STAGE_R0 + len(STAGES)
ws_r.cell(TOT_R, 2, "ИТОГО длительность цикла, суток")
for code, _, _, _ in CATEGORIES:
    cl = get_column_letter(CAT_COL[code])
    ws_r.cell(TOT_R, CAT_COL[code], f"=SUM({cl}{STAGE_R0}:{cl}{TOT_R-1})")
style_row(ws_r, TOT_R, 1, 7, F_BASE_B, FILL_ITEM)
ws_r.cell(TOT_R, 2).alignment = A_L
ws_r.row_dimensions[TOT_R].height = 20

def dur_ref(code, k):
    return f"Справочник!${get_column_letter(CAT_COL[code])}${STAGE_R0 + k}"

# --- Блок 2
R2 = TOT_R + 2
banner(ws_r, R2, 1, 10, "2. ПРОГРАММА КРЕПЛЕНИЯ СКВАЖИН И ДАТЫ ПОТРЕБНОСТИ МТР")
HDR2 = R2 + 1
for ci, t in [(1, "№"), (2, "Скважина / этап крепления"), (3, "Дата операции по графику"),
              (4, "Заблаговр., сут"), (5, "ДАТА ПОТРЕБНОСТИ (МТР на скважине)")]:
    ws_r.cell(HDR2, ci, t)
style_row(ws_r, HDR2, 1, 5, F_HDR, FILL_HDR)
autofit(ws_r, HDR2, [2, 3, 4, 5], size=9, minh=44)

OP_R0 = HDR2 + 1
for i, (well, op, date) in enumerate(OPERATIONS):
    rr = OP_R0 + i
    OP_ROW[(well, op)] = rr
    ws_r.cell(rr, 1, i + 1)
    ws_r.cell(rr, 2, f"{well} — {op}")
    ws_r.cell(rr, 3, date)
    ws_r.cell(rr, 4, NEED_LEAD)
    ws_r.cell(rr, 5, f"=C{rr}-D{rr}")
    style_row(ws_r, rr, 1, 5, F_BASE, FILL_BAND if (i // 4) % 2 == 0 else None)
    ws_r.cell(rr, 2).alignment = A_L
    ws_r.cell(rr, 2).font = F_BASE_B
    for ci in (3, 4):
        ws_r.cell(rr, ci).fill = FILL_INPUT
        ws_r.cell(rr, ci).font = F_INPUT
    ws_r.cell(rr, 3).number_format = DATE_FMT
    ws_r.cell(rr, 5).number_format = DATE_FMT
    ws_r.cell(rr, 5).font = F_BASE_B
    ws_r.cell(rr, 5).fill = FILL_ITEM
    ws_r.row_dimensions[rr].height = 19
    if i % 4 == 3:
        for ci in range(1, 6):
            ws_r.cell(rr, ci).border = Border(left=_thin, right=_thin, top=_thin, bottom=_med)

def need_ref(well, op):
    return f"Справочник!$E${OP_ROW[(well, op)]}"

# --- Блок 3
R3 = OP_R0 + len(OPERATIONS) + 1
banner(ws_r, R3, 1, 10, "3. НОМЕНКЛАТУРА МТР И ОБЪЕМЫ ЗАКУПКИ")
HDR3 = R3 + 1
for ci, t in [(1, "№"), (2, "Наименование МТР"), (3, "Ед. изм."), (4, "Категория поставки"),
              (5, "Этап крепления"), (6, "ЮГ-1"), (7, "ЮГ-2"), (8, "ЮГ-3"),
              (9, "ИТОГО (с резервом)"), (10, "Обоснование объема / характеристика")]:
    ws_r.cell(HDR3, ci, t)
style_row(ws_r, HDR3, 1, 10, F_HDR, FILL_HDR)
autofit(ws_r, HDR3, [2, 4, 5, 9, 10], size=9, minh=34)

NOM_R0 = HDR3 + 1
for i, (name, uom, cat, op, qty, res, note) in enumerate(NOMENCLATURE):
    rr = NOM_R0 + i
    ws_r.cell(rr, 1, i + 1)
    ws_r.cell(rr, 2, name)
    ws_r.cell(rr, 3, uom)
    ws_r.cell(rr, 4, CAT_SHORT[cat])
    ws_r.cell(rr, 5, op)
    for j in range(3):
        ws_r.cell(rr, 6 + j, qty)
    ws_r.cell(rr, 9, f"=SUM(F{rr}:H{rr})" + (f"+{res}" if res else ""))
    ws_r.cell(rr, 10, note)
    style_row(ws_r, rr, 1, 10, F_BASE, FILL_BAND if i % 2 == 0 else None)
    for ci in (2, 4, 5):
        ws_r.cell(rr, ci).alignment = A_L
    ws_r.cell(rr, 10).alignment = A_LT
    ws_r.cell(rr, 2).font = F_BASE_B
    ws_r.cell(rr, 10).font = F_NOTE
    for j in range(3):
        ws_r.cell(rr, 6 + j).fill = FILL_INPUT
        ws_r.cell(rr, 6 + j).font = F_INPUT
    ws_r.cell(rr, 9).font = F_BASE_B
    ws_r.cell(rr, 9).fill = FILL_ITEM
    autofit(ws_r, rr, [2, 5], size=9, minh=22)
    h8 = text_lines(note, WIDTHS["Справочник"][10], 8) * 11 + 5
    ws_r.row_dimensions[rr].height = max(ws_r.row_dimensions[rr].height, round(h8, 1))

NOM_LAST = NOM_R0 + len(NOMENCLATURE) - 1
qty_ref = lambda i, w: f"Справочник!${get_column_letter(6 + WELLS.index(w))}${NOM_R0 + i}"
uom_ref = lambda i: f"Справочник!$C${NOM_R0 + i}"

ws_r.freeze_panes = "A5"
page(ws_r)


# ============================================================================
# ЛИСТЫ 3-5 — ГРАФИКИ ПО СКВАЖИНАМ
# ============================================================================
W_W = {1: 5, 2: 58, 3: 9, 4: 10, 5: 17, 6: 9, 7: 12, 8: 12, 9: 13,
       10: 13, 11: 14, 12: 13, 13: 10, 14: 14, 15: 54}
W_H = ["№", "Наименование МТР / этапа закупки и доставки", "Ед. изм.", "Кол-во",
       "Этап крепления", "Длит., сут", "Начало этапа", "Окончание этапа",
       "ДАТА ПОТРЕБНОСТИ", "Требуемая дата старта", "Дата начала (план/факт)",
       "Прогноз поставки на скважину", "Запас, сут", "СТАТУС",
       "Примечание / компенсирующие мероприятия"]

well_item_row = {}

for well in WELLS:
    ws = wb.create_sheet(well)
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.outlinePr.summaryBelow = False
    set_widths(ws, W_W)

    ws.cell(1, 1, f"ГРАФИК ПОСТАВКИ МТР ДЛЯ КРЕПЛЕНИЯ СКВАЖИНЫ {well}").font = F_TITLE
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=15)
    ws.cell(1, 1).alignment = A_L
    ws.row_dimensions[1].height = 24
    ws.cell(2, 1, f"Южный участок Мутновского месторождения. Редакция 2 от "
                  f"{TODAY.strftime('%d.%m.%Y')}. Даты потребности и длительности этапов — с листа "
                  f"«Справочник». Желтые ячейки (столбец K) — ввод фактической даты размещения "
                  f"заказа. Группировка слева сворачивает этапы.").font = F_SUB
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=15)
    ws.cell(2, 1).alignment = A_L
    ws.row_dimensions[2].height = 15

    for i, h in enumerate(W_H, start=1):
        ws.cell(4, i, h)
    style_row(ws, 4, 1, 15, F_HDR, FILL_HDR)
    autofit(ws, 4, list(range(1, 16)), size=9, minh=46)

    rr = 5
    for idx, (name, uom, cat, op, qty, res, note) in enumerate(NOMENCLATURE):
        m = model[(well, idx)]
        hdr = rr
        well_item_row[(well, idx)] = hdr
        s0, s1 = hdr + 1, hdr + len(STAGES)

        ws.cell(hdr, 1, idx + 1)
        ws.cell(hdr, 2, name)
        ws.cell(hdr, 3, f"={uom_ref(idx)}")
        ws.cell(hdr, 4, f"={qty_ref(idx, well)}")
        ws.cell(hdr, 5, op)
        ws.cell(hdr, 6, f"=SUM(F{s0}:F{s1})")
        ws.cell(hdr, 9, f"={need_ref(well, op)}")
        ws.cell(hdr, 10, f"=I{hdr}-F{hdr}")
        ws.cell(hdr, 11, m["planned"])
        ws.cell(hdr, 12, f"=H{s1}")
        ws.cell(hdr, 13, f"=I{hdr}-L{hdr}")
        ws.cell(hdr, 14, f'=IF(M{hdr}<0,"СРЫВ ГРАФИКА",IF(M{hdr}<{RISK_THRESHOLD},"РИСК","В ГРАФИКЕ"))')
        ws.cell(hdr, 15, m["action"])

        style_row(ws, hdr, 1, 15, F_ITEM, FILL_ITEM, border=B_ITEM)
        ws.cell(hdr, 2).alignment = A_L
        ws.cell(hdr, 5).font = F_NOTE
        for ci in (9, 10, 11, 12):
            ws.cell(hdr, ci).number_format = DATE_FMT
        ws.cell(hdr, 11).fill = FILL_INPUT
        ws.cell(hdr, 11).font = F_INPUT
        ws.cell(hdr, 15).font = F_ACT
        ws.cell(hdr, 15).alignment = A_LT
        ws.row_dimensions[hdr].height = round(max(
            text_lines(name, W_W[2], 10) * 13.5,
            text_lines(op, W_W[5], 8) * 11.5,
            text_lines(m["action"], W_W[15], 8) * 11.5) + 7, 1)

        for k, st in enumerate(STAGES):
            r_ = s0 + k
            ws.cell(r_, 1, k + 1)
            ws.cell(r_, 2, f"=Справочник!$B${STAGE_R0 + k}")
            ws.cell(r_, 6, f"={dur_ref(cat, k)}")
            ws.cell(r_, 7, f"=K{hdr}" if k == 0 else f"=H{r_-1}")
            ws.cell(r_, 8, f"=G{r_}+F{r_}")
            ws.row_dimensions[r_].outlineLevel = 1
            style_row(ws, r_, 1, 15, F_BASE, FILL_BAND if k % 2 == 0 else None)
            ws.cell(r_, 2).alignment = A_L
            ws.cell(r_, 7).number_format = DATE_FMT
            ws.cell(r_, 8).number_format = DATE_FMT
            ws.row_dimensions[r_].height = round(text_lines(st, W_W[2], 9) * 12.2 + 5, 1)

        rr = s1 + 2

    W_LAST = rr - 2
    for st, sty in CLR.items():
        ds = DifferentialStyle(font=Font(bold=True, color=sty["text"]),
                               fill=PatternFill("solid", bgColor=sty["cell"]))
        ws.conditional_formatting.add(
            f"M5:N{W_LAST}",
            Rule(type="expression", formula=[f'$N5="{st}"'], dxf=ds, stopIfTrue=True))

    ws.freeze_panes = "C5"
    page(ws, titles="4:4")


# ============================================================================
# ЛИСТ 6 — СВОДНЫЙ ГРАФИК (диаграмма Ганта)
# ============================================================================
_all_dates = [d for m in model.values() for d in (m["planned"], m["forecast"], m["need"])]
GANTT_FROM = min(_all_dates).replace(day=1)
_end = max(_all_dates) + dt.timedelta(days=15)
GANTT_TO = (_end.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
NDAYS = (GANTT_TO - GANTT_FROM).days + 1

T0 = 13
TLAST = T0 + NDAYS - 1
TL0, TLL = get_column_letter(T0), get_column_letter(TLAST)

gs = wb.create_sheet("СВОДНЫЙ ГРАФИК")
gs.sheet_view.showGridLines = False
G_W = {1: 5, 2: 9, 3: 54, 4: 9, 5: 9, 6: 12, 7: 12, 8: 12, 9: 12, 10: 9, 11: 14, 12: 46}
set_widths(gs, G_W)
for ci in range(T0, TLAST + 1):
    gs.column_dimensions[get_column_letter(ci)].width = 2.4

gs.cell(1, 1, TITLE).font = F_TITLE
gs.merge_cells(start_row=1, start_column=1, end_row=1, end_column=12)
gs.cell(1, 1).alignment = A_L
gs.row_dimensions[1].height = 30

gs.cell(2, 1, f"Редакция 2 от {TODAY.strftime('%d.%m.%Y')}. Вертикальная линия — текущая дата "
              f"(функция СЕГОДНЯ, пересчитывается при открытии файла); цвет линии в строке "
              f"соответствует статусу позиции.").font = F_SUB
gs.merge_cells(start_row=2, start_column=1, end_row=2, end_column=10)
gs.cell(2, 1).alignment = A_LT
gs.cell(2, 11, "ОБЩИЙ СТАТУС:")
gs.cell(2, 11).font = F_BASE_B
gs.cell(2, 11).alignment = Alignment(horizontal="right", vertical="center")
gs.row_dimensions[2].height = round(
    text_lines(gs.cell(2, 1).value, sum(G_W[i] for i in range(1, 11)), 9) * 12 + 5, 1)

# --- легенда: два ряда по два элемента, текст в объединенных диапазонах
G_LEG1, G_LEG2, G_BAN, G_HDR = 3, 4, 5, 6
LEG = [("Производственный цикл (согласование спецификации, изготовление, затарка)", "E2EFDA"),
       ("Транспортное плечо (ж/д, перевалка, море, доставка с порта на скважину)", "A9D08E"),
       ("Дата потребности МТР на скважине", "002060"),
       ("Вертикальная линия текущей даты (цвет — по статусу строки)", "404040")]
for k, (txt, color) in enumerate(LEG):
    row = G_LEG1 if k < 2 else G_LEG2
    sw, t1, t2 = (1, 2, 6) if k % 2 == 0 else (7, 8, 12)
    c = gs.cell(row, sw); c.fill = PatternFill("solid", fgColor=color); c.border = B_ALL
    t = gs.cell(row, t1, txt); t.font = F_NOTE
    t.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True, indent=1)
    gs.merge_cells(start_row=row, start_column=t1, end_row=row, end_column=t2)
for row in (G_LEG1, G_LEG2):
    gs.row_dimensions[row].height = 15
gs.cell(G_LEG1, 1).border = B_ALL

# --- шапка
G_H = ["№", "Скважина", "Наименование МТР", "Ед. изм.", "Кол-во", "Дата начала (план/факт)",
       "Окончание изготовления", "Прогноз поставки", "ДАТА ПОТРЕБНОСТИ", "Запас, сут",
       "СТАТУС", "Примечание / компенсирующие мероприятия"]
banner(gs, G_BAN, 1, 12, "ПОЗИЦИИ ЗАКУПКИ И ДОСТАВКИ МТР", size=10)
for i, h in enumerate(G_H, start=1):
    gs.cell(G_HDR, i, h)
style_row(gs, G_HDR, 1, 12, F_HDR, FILL_HDR)
autofit(gs, G_HDR, list(range(1, 13)), size=9, minh=44)

# --- шкала времени
MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
d, ci, mstart = GANTT_FROM, T0, T0
while d <= GANTT_TO:
    c = gs.cell(G_HDR, ci, d)
    c.number_format = "d"
    c.font = Font(name="Calibri", size=6, color="595959")
    c.alignment = Alignment(horizontal="center", vertical="center")
    c.border = Border(left=Side(style="hair", color="D9D9D9"),
                      right=Side(style="hair", color="D9D9D9"), top=_thin, bottom=_thin)
    nxt = d + dt.timedelta(days=1)
    if nxt.month != d.month or nxt > GANTT_TO:
        gs.merge_cells(start_row=G_BAN, start_column=mstart, end_row=G_BAN, end_column=ci)
        mc = gs.cell(G_BAN, mstart, f"{MON[d.month-1]} {d.year}")
        mc.font = Font(name="Calibri", size=8, bold=True, color="FFFFFF")
        mc.fill = FILL_HDR; mc.alignment = A_C; mc.border = B_ALL
        mstart = ci + 1
    d = nxt
    ci += 1

# --- строки данных
GROW0 = G_HDR + 1
rr = GROW0
gantt_rows = {}
n = 0
for well in WELLS:
    gs.cell(rr, 1, f"СКВАЖИНА {well}")
    gs.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=12)
    style_row(gs, rr, 1, 12, Font(name="Calibri", size=10, bold=True, color="FFFFFF"),
              FILL_SUB, align=A_L)
    for ci2 in range(T0, TLAST + 1):
        gs.cell(rr, ci2).fill = PatternFill("solid", fgColor="DDEBF7")
    gs.row_dimensions[rr].height = 19
    rr += 1
    for idx in range(len(NOMENCLATURE)):
        n += 1
        src = well_item_row[(well, idx)]
        m = model[(well, idx)]
        gs.cell(rr, 1, n)
        gs.cell(rr, 2, well)
        gs.cell(rr, 3, f"='{well}'!B{src}")
        gs.cell(rr, 4, f"='{well}'!C{src}")
        gs.cell(rr, 5, f"='{well}'!D{src}")
        gs.cell(rr, 6, f"='{well}'!K{src}")
        gs.cell(rr, 7, f"='{well}'!H{src+3}")
        gs.cell(rr, 8, f"='{well}'!L{src}")
        gs.cell(rr, 9, f"='{well}'!I{src}")
        gs.cell(rr, 10, f"='{well}'!M{src}")
        gs.cell(rr, 11, f"='{well}'!N{src}")
        gs.cell(rr, 12, m["action_short"])
        style_row(gs, rr, 1, 12, F_BASE, FILL_BAND if idx % 2 == 0 else None)
        gs.cell(rr, 3).alignment = A_L
        gs.cell(rr, 3).font = F_BASE_B
        gs.cell(rr, 12).alignment = A_L
        gs.cell(rr, 12).font = F_ACT
        for ci2 in (6, 7, 8, 9):
            gs.cell(rr, ci2).number_format = DATE_FMT
        gs.cell(rr, 9).font = F_BASE_B
        hair = Side(style="hair", color="EDEDED")
        for ci2 in range(T0, TLAST + 1):
            gs.cell(rr, ci2).border = Border(left=hair, right=hair, top=hair, bottom=hair)
        gs.row_dimensions[rr].height = round(max(
            text_lines(m["name"], G_W[3], 9) * 12.2,
            text_lines(m["action_short"], G_W[12], 8) * 11.5) + 6, 1)
        gantt_rows[(well, idx)] = rr
        rr += 1
GLAST = rr - 1

for st, sty in CLR.items():
    ds = DifferentialStyle(font=Font(bold=True, color=sty["text"]),
                           fill=PatternFill("solid", bgColor=sty["cell"]))
    gs.conditional_formatting.add(f"J{GROW0}:K{GLAST}",
        Rule(type="expression", formula=[f'$K{GROW0}="{st}"'], dxf=ds, stopIfTrue=True))
    ds2 = DifferentialStyle(font=Font(bold=True, size=10, color=sty["text"]),
                            fill=PatternFill("solid", bgColor=sty["cell"]))
    gs.conditional_formatting.add("L2",
        Rule(type="expression", formula=[f'$L$2="{st}"'], dxf=ds2, stopIfTrue=True))

gs.cell(2, 12, f'=IF(COUNTIF(K{GROW0}:K{GLAST},"СРЫВ ГРАФИКА")>0,"СРЫВ ГРАФИКА",'
               f'IF(COUNTIF(K{GROW0}:K{GLAST},"РИСК")>0,"РИСК","В ГРАФИКЕ"))')
gs.cell(2, 12).alignment = A_C
gs.cell(2, 12).border = B_ALL

AREA = f"{TL0}{GROW0}:{TLL}{GLAST}"
R = GROW0
TC = f"{TL0}${G_HDR}"

def cf(formula, color, stop=True):
    gs.conditional_formatting.add(AREA, Rule(
        type="expression", formula=[formula],
        dxf=DifferentialStyle(fill=PatternFill("solid", bgColor=color)), stopIfTrue=stop))

for st in ("СРЫВ ГРАФИКА", "РИСК", "В ГРАФИКЕ"):
    cf(f'AND({TC}=TODAY(),$K{R}="{st}")', CLR[st]["line"])
cf(f'{TC}=TODAY()', "404040")
cf(f'AND($I{R}<>"",{TC}=$I{R})', "002060")
for st in ("СРЫВ ГРАФИКА", "РИСК", "В ГРАФИКЕ"):
    cf(f'AND($G{R}<>"",{TC}>$G{R},{TC}<=$H{R},$K{R}="{st}")', CLR[st]["transport"])
for st in ("СРЫВ ГРАФИКА", "РИСК", "В ГРАФИКЕ"):
    cf(f'AND($F{R}<>"",{TC}>=$F{R},{TC}<=$G{R},$K{R}="{st}")', CLR[st]["prod"])
cf(f'WEEKDAY({TC},2)>5', "F2F2F2", stop=False)

gs.conditional_formatting.add(f"{TL0}{G_HDR}:{TLL}{G_HDR}", Rule(
    type="expression", formula=[f"{TL0}${G_HDR}=TODAY()"],
    dxf=DifferentialStyle(fill=PatternFill("solid", bgColor="404040"),
                          font=Font(bold=True, color="FFFFFF")), stopIfTrue=True))

gs.freeze_panes = f"{TL0}{GROW0}"
gs.auto_filter.ref = f"A{G_HDR}:L{GLAST}"
page(gs, titles=f"{G_BAN}:{G_HDR}")


# ============================================================================
# ЛИСТ 7 — СВОДНАЯ ПОТРЕБНОСТЬ
# ============================================================================
ss = wb.create_sheet("Сводная потребность")
ss.sheet_view.showGridLines = False
S_W = {1: 5, 2: 52, 3: 9, 4: 10, 5: 10, 6: 10, 7: 13, 8: 12, 9: 14, 10: 11, 11: 15, 12: 46}
set_widths(ss, S_W)

ss.cell(1, 1, "СВОДНАЯ ПОТРЕБНОСТЬ В МТР НА КРЕПЛЕНИЕ СКВАЖИН ЮГ-1, ЮГ-2, ЮГ-3").font = F_TITLE
ss.merge_cells("A1:L1")
ss.cell(1, 1).alignment = A_L
ss.row_dimensions[1].height = 24
ss.cell(2, 1, "Объем закупки по номенклатуре в целом по программе (ИТОГО — с учетом резерва, "
              "заданного на листе «Справочник»). Статус — худший из трех скважин.").font = F_SUB
ss.merge_cells("A2:L2")
ss.cell(2, 1).alignment = A_L
ss.row_dimensions[2].height = 15

S_H = ["№", "Наименование МТР", "Ед. изм.", "ЮГ-1", "ЮГ-2", "ЮГ-3", "ИТОГО (с резервом)",
       "Цикл поставки, сут", "Самая ранняя потребность", "Мин. запас, сут", "ХУДШИЙ СТАТУС",
       "Примечание / компенсирующие мероприятия"]
for i, h in enumerate(S_H, start=1):
    ss.cell(4, i, h)
style_row(ss, 4, 1, 12, F_HDR, FILL_HDR)
autofit(ss, 4, list(range(1, 13)), size=9, minh=44)

sr = 5
for idx, (name, uom, cat, op, qty, res, note) in enumerate(NOMENCLATURE):
    needs = [f"'{w}'!I{well_item_row[(w, idx)]}" for w in WELLS]
    slacks = [f"'{w}'!M{well_item_row[(w, idx)]}" for w in WELLS]
    worst = min(model[(w, idx)]["slack"] for w in WELLS)
    wkey = [w for w in WELLS if model[(w, idx)]["slack"] == worst][0]
    ss.cell(sr, 1, idx + 1)
    ss.cell(sr, 2, f"=Справочник!B{NOM_R0 + idx}")
    ss.cell(sr, 3, f"=Справочник!C{NOM_R0 + idx}")
    for j, w in enumerate(WELLS):
        ss.cell(sr, 4 + j, f"='{w}'!D{well_item_row[(w, idx)]}")
    ss.cell(sr, 7, f"=Справочник!I{NOM_R0 + idx}")
    ss.cell(sr, 8, f"='{WELLS[0]}'!F{well_item_row[(WELLS[0], idx)]}")
    ss.cell(sr, 9, f"=MIN({','.join(needs)})")
    ss.cell(sr, 10, f"=MIN({','.join(slacks)})")
    ss.cell(sr, 11, f'=IF(J{sr}<0,"СРЫВ ГРАФИКА",IF(J{sr}<{RISK_THRESHOLD},"РИСК","В ГРАФИКЕ"))')
    ss.cell(sr, 12, model[(wkey, idx)]["action_short"] +
            (f" (по {wkey})" if model[(wkey, idx)]["action_short"] else ""))
    style_row(ss, sr, 1, 12, F_BASE, FILL_BAND if idx % 2 == 0 else None)
    ss.cell(sr, 2).alignment = A_L
    ss.cell(sr, 2).font = F_BASE_B
    ss.cell(sr, 12).alignment = A_L
    ss.cell(sr, 12).font = F_ACT
    ss.cell(sr, 7).font = F_BASE_B
    ss.cell(sr, 7).fill = FILL_ITEM
    ss.cell(sr, 9).number_format = DATE_FMT
    ss.cell(sr, 9).font = F_BASE_B
    ss.row_dimensions[sr].height = round(max(
        text_lines(name, S_W[2], 9) * 12.2,
        text_lines(ss.cell(sr, 12).value, S_W[12], 8) * 11.5) + 6, 1)
    sr += 1
S_LAST = sr - 1

for st, sty in CLR.items():
    ds = DifferentialStyle(font=Font(bold=True, color=sty["text"]),
                           fill=PatternFill("solid", bgColor=sty["cell"]))
    ss.conditional_formatting.add(f"J5:K{S_LAST}",
        Rule(type="expression", formula=[f'$K5="{st}"'], dxf=ds, stopIfTrue=True))

ss.freeze_panes = "A5"
ss.auto_filter.ref = f"A4:L{S_LAST}"
page(ss)

# ============================================================================
OUT = "/home/user/nestro/mtr_schedule/График_поставки_МТР_крепление_ЮГ-1_ЮГ-2_ЮГ-3.xlsx"
wb.active = wb.sheetnames.index("СВОДНЫЙ ГРАФИК")
wb.save(OUT)

print("OK ->", OUT)
print(f"позиций: {len(NOMENCLATURE)} x {len(WELLS)} = {len(NOMENCLATURE)*len(WELLS)}; "
      f"шкала {GANTT_FROM:%d.%m.%Y}-{GANTT_TO:%d.%m.%Y} ({NDAYS} дн., столбцы {TL0}..{TLL})")
by = {}
for v in model.values():
    by[v["status"]] = by.get(v["status"], 0) + 1
print("статусы:", by)
for w in WELLS:
    bad = [(model[(w, i)]["name"], model[(w, i)]["slack"], model[(w, i)]["status"])
           for i in range(len(NOMENCLATURE)) if model[(w, i)]["status"] != "В ГРАФИКЕ"]
    print(f"  {w}: " + ("; ".join(f"{nm} ({s:+d})" for nm, s, _ in bad) if bad else "все в графике"))
