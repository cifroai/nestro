# -*- coding: utf-8 -*-
"""
Проект презентации «Качество цементирования обсадных колонн, 2025 → 2026»
на корпоративном шаблоне (template/Шаблон_внутренний.pptx).

Все числа берутся из словаря метрик M (data/metrics.json, формируется расчётом по реестру).
Если файла нет или значения нет — выводится «н/д». Никакие значения не подставляются по умолчанию.

Запуск:  python3 deck.py [--metrics ../data/metrics.json] [--out ../output/...pptx]
"""
import argparse
import datetime as dt
import json
import os
from copy import deepcopy

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION, XL_TICK_LABEL_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt, Emu

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEMPLATE = os.path.join(ROOT, "template", "Шаблон_внутренний.pptx")

# ---------- Бренд (тема «Зарубежнефть» из шаблона) ----------
NAVY = RGBColor(0x00, 0x32, 0x6E)      # dk1 — заголовки, текст
NAVY_D = RGBColor(0x00, 0x18, 0x45)    # accent1 — строки-группы в таблицах
BLUE = RGBColor(0x00, 0x54, 0x91)      # accent2
BLUE_L = RGBColor(0x00, 0x78, 0xAE)    # accent3 — ряд 2025
GREEN_D = RGBColor(0x0A, 0x8F, 0x2D)   # accent4 — ряд 2026
GREEN = RGBColor(0x4B, 0xAF, 0x46)     # dk2/accent5 — подзаголовки
LIME = RGBColor(0x9A, 0xC8, 0x54)      # accent6
LIME_L = RGBColor(0xCE, 0xE1, 0xA5)    # hlink
LIME_XL = RGBColor(0xEB, 0xF0, 0xD6)   # folHlink
TBL_HEAD = RGBColor(0x00, 0x9C, 0x3D)  # шапка таблиц в шаблоне (слайд 25)
CARD = RGBColor(0xE5, 0xEA, 0xF0)      # карточки в шаблоне (слайды 10, 34)
GREY = RGBColor(0x5A, 0x5A, 0x5A)      # lt2 — вспомогательный текст
ND_FILL = RGBColor(0xF2, 0xF4, 0xF7)   # ячейка «н/д»
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
UNDER = RGBColor(0xC0, 0x39, 0x2B)     # статус «недоподъём» (только со словом-меткой)
MED_2025 = RGBColor(0x7F, 0xBB, 0xD6)  # медиана 2025 — светлый тон синего
MED_2026 = LIME                        # медиана 2026 — светлый тон зелёного

BODY_FONT = "TT Bluescreens Pro Normal"  # узкое начертание семейства — для таблиц и подписей
ND = "н/д"

# Последовательная шкала сцепления (один оттенок, светлый → тёмный); это не критерий «хорошо/плохо»
HEAT = [(0.90, GREEN_D, WHITE), (0.85, GREEN, WHITE), (0.80, LIME, NAVY), (0.70, LIME_L, NAVY), (-1, LIME_XL, NAVY)]


# ---------- Форматирование ----------
def fnum(v, nd=2):
    if v is None:
        return ND
    return f"{v:.{nd}f}".replace(".", ",")


def fint(v):
    return ND if v is None else f"{int(v):,}".replace(",", " ")


def fpct(num, den):
    if num is None or den in (None, 0):
        return ND
    return f"{round(100 * num / den)} %"


def fm(v):  # метры со знаком
    if v is None:
        return ND
    return f"{v:+.0f}".replace("-", "−")


def heat(v):
    if v is None:
        return ND_FILL, GREY
    for thr, bg, fg in HEAT:
        if v >= thr:
            return bg, fg
    return LIME_XL, NAVY


def g(d, *path):
    """Безопасное чтение вложенных метрик: отсутствующее → None."""
    for p in path:
        if not isinstance(d, dict) or p not in d:
            return None
        d = d[p]
    return d


# ---------- Базовые операции со слайдами ----------
def open_template():
    prs = Presentation(TEMPLATE)
    lst = prs.slides._sldIdLst
    for sid in list(lst):
        prs.part.drop_rel(sid.rId)
        lst.remove(sid)
    return prs


def layout(prs, name):
    for l in prs.slide_layouts:
        if l.name == name:
            return l
    raise KeyError(name)


def set_ph(slide, idx, text):
    ph = slide.placeholders[idx]
    tf = ph.text_frame
    lines = text.split("\n")
    # пишем через run, чтобы сохранить стиль плейсхолдера из макета
    p0 = tf.paragraphs[0]
    for r in list(p0.runs)[1:]:
        r._r.getparent().remove(r._r)
    if p0.runs:
        p0.runs[0].text = lines[0]
    else:
        p0.add_run().text = lines[0]
    for extra in lines[1:]:
        tf.add_paragraph().add_run().text = extra
    return ph


def text(slide, x, y, w, h, runs, size=11, color=NAVY, bold=False, align=PP_ALIGN.LEFT,
         anchor=MSO_ANCHOR.TOP, font=BODY_FONT, italic=False, margin=0.0):
    """runs: str | list[(text, {opts})] ; перенос абзаца — '\n' в тексте."""
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    for side in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
        setattr(tf, side, Inches(margin))
    if isinstance(runs, str):
        runs = [(runs, {})]
    p = tf.paragraphs[0]
    p.alignment = align
    for t, o in runs:
        parts = t.split("\n")
        for i, part in enumerate(parts):
            if i > 0:
                p = tf.add_paragraph()
                p.alignment = align
            if not part:
                continue
            r = p.add_run()
            r.text = part
            f = r.font
            f.size = Pt(o.get("size", size))
            f.bold = o.get("bold", bold)
            f.italic = o.get("italic", italic)
            f.name = o.get("font", font)
            f.color.rgb = o.get("color", color)
    return tb


def rect(slide, x, y, w, h, fill=CARD, line=None, shape=MSO_SHAPE.RECTANGLE, lw=0.75):
    s = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    s.shadow.inherit = False
    if fill is None:
        s.fill.background()
    else:
        s.fill.solid()
        s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(lw)
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        s.adjustments[0] = 0.5
    s.text_frame.text = ""
    return s


def draft_tag(slide, label="ПРОЕКТ · данные реестра ожидаются"):
    """Метка черновика — «пилюля» как дата на титульном слайде шаблона."""
    pill = rect(slide, 9.55, 0.08, 3.35, 0.28, fill=WHITE, line=NAVY, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    tf = pill.text_frame
    tf.margin_left = tf.margin_right = Inches(0.08)
    tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = label
    r.font.size = Pt(9)
    r.font.name = BODY_FONT
    r.font.color.rgb = NAVY


def content_slide(prs, title, subtitle, footer):
    s = prs.slides.add_slide(layout(prs, "Инфографика"))
    for idx, txt, size in ((0, title, 28), (2, subtitle, 14)):
        ph = set_ph(s, idx, txt)
        for r in ph.text_frame.paragraphs[0].runs:
            r.font.size = Pt(size)
    set_ph(s, 10, footer)
    return s


def card_top(slide, x, y, w, h, color=GREEN):
    """Карточка шаблона: светло-серо-голубая плашка с цветной верхней кромкой (слайды 10, 34)."""
    rect(slide, x, y, w, h, fill=CARD)
    rect(slide, x, y, w, 0.06, fill=color)


def note(slide, x, y, w, h, txt, size=9):
    text(slide, x, y, w, h, txt, size=size, color=GREY, italic=True)


# ---------- Таблицы ----------
def style_cell(cell, txt, size=9, bold=False, fill=WHITE, color=NAVY, align=PP_ALIGN.CENTER, font=BODY_FONT):
    cell.fill.solid()
    cell.fill.fore_color.rgb = fill
    cell.margin_left = cell.margin_right = Inches(0.05)
    cell.margin_top = cell.margin_bottom = Inches(0.02)
    cell.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf = cell.text_frame
    tf.word_wrap = True
    lines = txt.split("\n") if isinstance(txt, str) else [txt]
    p = tf.paragraphs[0]
    for i, ln in enumerate(lines):
        if i:
            p = tf.add_paragraph()
        p.alignment = align
        r = p.add_run()
        r.text = ln
        r.font.size = Pt(size if i == 0 else max(size - 2, 7))
        r.font.bold = bold if i == 0 else False
        r.font.name = font
        r.font.color.rgb = color


def table(slide, x, y, w, col_w, rows, row_h):
    """rows: список строк; строка — список ячеек dict(t=, fill=, color=, bold=, size=, align=, span=)."""
    nrows, ncols = len(rows), len(col_w)
    gt = slide.shapes.add_table(nrows, ncols, Inches(x), Inches(y), Inches(w), Inches(sum(row_h) if isinstance(row_h, list) else row_h * nrows))
    tbl = gt.table
    tblPr = tbl._tbl.tblPr
    for a in ("firstRow", "bandRow"):
        tblPr.set(a, "0")
    # убрать стиль таблицы шаблона — оформление задаётся явно
    sid = tblPr.find(qn("a:tableStyleId"))
    if sid is not None:
        sid.text = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}"  # «Нет стиля, нет сетки»
    for j, cw in enumerate(col_w):
        tbl.columns[j].width = Inches(cw)
    for i, row in enumerate(rows):
        tbl.rows[i].height = Inches(row_h[i] if isinstance(row_h, list) else row_h)
        j = 0
        for c in row:
            span = c.get("span", 1)
            cell = tbl.cell(i, j)
            if span > 1:
                cell.merge(tbl.cell(i, j + span - 1))
            style_cell(cell, c.get("t", ""), size=c.get("size", 9), bold=c.get("bold", False),
                       fill=c.get("fill", WHITE), color=c.get("color", NAVY), align=c.get("align", PP_ALIGN.CENTER))
            j += span
    # тонкие белые разделители между ячейками
    for tc in tbl._tbl.iter(qn("a:tc")):
        tcPr = tc.get_or_add_tcPr()
        for tag in ("a:lnL", "a:lnR", "a:lnT", "a:lnB"):
            ln = tcPr.find(qn(tag))
            if ln is None:
                ln = tcPr.makeelement(qn(tag), {})
                tcPr.insert(0, ln)
            ln.set("w", str(Pt(1.5)))
            sf = ln.makeelement(qn("a:solidFill"), {})
            clr = sf.makeelement(qn("a:srgbClr"), {"val": "FFFFFF"})
            sf.append(clr)
            for ch in list(ln):
                ln.remove(ch)
            ln.append(sf)
    return tbl


def H(t, span=1, fill=TBL_HEAD, size=8.5):
    return dict(t=t, span=span, fill=fill, color=WHITE, bold=True, size=size)


def GROUP(t, span):
    return dict(t=t, span=span, fill=NAVY, color=WHITE, bold=True, size=9, align=PP_ALIGN.LEFT)


def LBL(t, fill=WHITE, size=9):
    return dict(t=t, fill=fill, color=NAVY, size=size, align=PP_ALIGN.LEFT)


def VAL(t, fill=WHITE, color=NAVY, size=9, bold=False):
    return dict(t=t, fill=fill, color=color, size=size, bold=bold)


def HEATC(mean, med, n):
    bg, fg = heat(mean)
    if mean is None:
        return dict(t=ND, fill=ND_FILL, color=GREY, size=9)
    return dict(t=f"{fnum(mean)} / {fnum(med)}\nn = {fint(n)}", fill=bg, color=fg, size=10, bold=True)


# ---------- Диаграммы ----------
def chart_base(ch, legend=True, size=9):
    ch.has_title = False
    ch.font.size = Pt(size)
    ch.font.name = BODY_FONT
    ch.font.color.rgb = GREY
    ch.has_legend = legend
    if legend:
        ch.legend.position = XL_LEGEND_POSITION.BOTTOM
        ch.legend.include_in_layout = False
        ch.legend.font.size = Pt(size)
    va = ch.value_axis
    va.has_major_gridlines = True
    va.major_gridlines.format.line.color.rgb = RGBColor(0xDD, 0xE3, 0xEA)
    va.major_gridlines.format.line.width = Pt(0.5)
    va.format.line.fill.background()
    va.tick_labels.font.size = Pt(size - 1)
    ca = ch.category_axis
    ca.format.line.color.rgb = RGBColor(0xB8, 0xC2, 0xCE)
    ca.tick_labels.font.size = Pt(size)
    ca.tick_labels.font.color.rgb = NAVY
    ca.has_major_gridlines = False


def color_series(ch, colors, labels=True, fmt='0.00'):
    for s, c in zip(ch.plots[0].series, colors):
        s.format.fill.solid()
        s.format.fill.fore_color.rgb = c
        s.format.line.fill.background()
        s.invert_if_negative = False
    pl = ch.plots[0]
    pl.gap_width = 60
    pl.overlap = -10 if len(colors) > 1 else 0
    if labels:
        pl.has_data_labels = True
        dl = pl.data_labels
        dl.number_format = fmt
        dl.number_format_is_linked = False
        dl.position = XL_LABEL_POSITION.OUTSIDE_END
        dl.font.size = Pt(9)
        dl.font.color.rgb = NAVY


def empty_overlay(slide, x, y, w, h, msg="Данные появятся после загрузки реестра"):
    text(slide, x, y + h / 2 - 0.2, w, 0.4, msg, size=10, color=GREY, italic=True, align=PP_ALIGN.CENTER)


# =====================================================================
def build(M, out):
    prs = open_template()
    ref = lambda sheet: f"Качество цементирования 2025–2026 · расчёт: лист «{sheet}»"
    has = bool(M)

    # ---------- 0. Титульный ----------
    s = prs.slides.add_slide(layout(prs, "1_Титульный слайд"))
    set_ph(s, 0, "Качество цементирования обсадных колонн")
    set_ph(s, 13, "СП «Русвьетпетро» · 2025 → 2026\nАКЦ, ВПЦ, осложнения, SRTi")
    date = dt.date.today().strftime("%d.%m.%Y")
    pill = rect(s, 0.41, 6.72, 1.35, 0.32, fill=WHITE, line=NAVY, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    tf = pill.text_frame
    tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = date; r.font.size = Pt(11); r.font.color.rgb = NAVY; r.font.name = BODY_FONT
    if not has:
        text(s, 1.95, 6.72, 4.5, 0.32, "Проект: структура и методика; значения — после получения реестра",
             size=9, color=GREY, italic=True, anchor=MSO_ANCHOR.MIDDLE)

    # ---------- 1. Охват анализа ----------
    s = content_slide(prs, "Охват анализа", "Скважины, законченные бурением в 2025 и 2026 гг.; пригодность оценки АКЦ", ref("S1_Охват"))
    if not has: draft_tag(s)
    kpis = [
        ("Скважин закончено бурением", "wells"),
        ("из них наклонно направленных", "wells_nn"),
        ("из них горизонтальных", "wells_gs"),
        ("Операций цементирования (колонн)", "strings_cemented"),
        ("Колонн с пригодной оценкой АКЦ", "strings_akc_valid"),
        ("Сопоставимых пар ВПЦ план/факт", "toc_pairs"),
    ]
    cw, ch_, gx, gy, x0, y0 = 2.35, 1.42, 0.18, 0.2, 0.41, 1.72
    for i, (lab, key) in enumerate(kpis):
        cx, cy = x0 + (i % 3) * (cw + gx), y0 + (i // 3) * (ch_ + gy)
        card_top(s, cx, cy, cw, ch_, color=GREEN if i % 3 == 0 else (BLUE_L if i % 3 == 1 else LIME))
        text(s, cx + 0.15, cy + 0.14, cw - 0.3, 0.42, lab, size=9.5, color=NAVY)
        for k, yr in enumerate(("2025", "2026")):
            v = g(M, "coverage", yr, key)
            text(s, cx + 0.15 + k * 1.1, cy + 0.6, 1.05, 0.5, fint(v), size=22 if v is not None else 16,
                 color=BLUE_L if yr == "2025" else GREEN_D, font=None, anchor=MSO_ANCHOR.BOTTOM)
            text(s, cx + 0.15 + k * 1.1, cy + 1.1, 1.05, 0.22, yr, size=8.5, color=GREY)
    # Воронка пригодности данных (2026) — горизонтальные столбцы
    fx, fy, fw, fh = 8.05, 1.72, 4.88, 3.04
    rect(s, fx, fy, fw, fh, fill=WHITE, line=CARD)
    steps = [("Скважин", "wells"), ("Колонн всего", "strings_total"), ("Цементируемых колонн", "strings_cemented"),
             ("С результатом АКЦ", "strings_akc"), ("С пригодной АКЦ", "strings_akc_valid"), ("С парой ВПЦ план/факт", "toc_pairs")]
    cd = CategoryChartData()
    cd.categories = [a for a, _ in reversed(steps)]
    cd.add_series("2026", [g(M, "coverage", "2026", k) for _, k in reversed(steps)])
    gf = s.shapes.add_chart(XL_CHART_TYPE.BAR_CLUSTERED, Inches(fx + 0.05), Inches(fy + 0.35), Inches(fw - 0.1), Inches(fh - 0.4), cd)
    c = gf.chart
    chart_base(c, legend=False)
    color_series(c, [GREEN_D], fmt="0")
    c.value_axis.visible = False
    c.value_axis.has_major_gridlines = False
    text(s, fx + 0.15, fy + 0.08, fw - 0.3, 0.3, "Путь данных 2026: от скважины до пригодной оценки", size=10, bold=True, color=NAVY)
    if not has: empty_overlay(s, fx + 1.5, fy + 0.4, fw - 1.6, fh - 0.5)
    # Полнота данных
    text(s, 0.41, 5.02, 12.52, 0.3, "Полнота данных", size=11, bold=True, color=GREEN)
    comp = [("Год окончания бурения", "drill_end_year"), ("Тип скважины (НН/ГС)", "profile"), ("Назначение колонны", "string_purpose"),
            ("Кс, открытый ствол", "bond_oh"), ("Кс, весь интервал", "bond_full"), ("ВПЦ план и факт", "toc"), ("Статус SRTi", "srti"),
            ("Подрядчик бурения / цементирования", "contractors")]
    rows = [[H("Показатель")] + [H(a, size=7.5) for a, _ in comp]]
    for yr in ("2025", "2026"):
        rows.append([LBL(f"{yr}: заполнено")] + [VAL(fpct(g(M, "completeness", yr, k, "filled"), g(M, "completeness", yr, k, "total")),
                                                   fill=CARD if yr == "2025" else WHITE) for _, k in comp])
    table(s, 0.41, 5.35, 12.52, [1.72] + [1.35] * 8, rows, [0.52, 0.34, 0.34])
    note(s, 0.41, 6.62, 12.52, 0.3, "Единица учёта: скважина — по году окончания бурения; колонна — отдельная операция цементирования. "
         "Дата АКЦ не определяет год. Нецементируемые хвостовики в оценку качества не входят.", size=8.5)

    # ---------- 2. Общая динамика ----------
    s = content_slide(prs, "Общая динамика 2025 → 2026", "Сцепление в открытом стволе и по всему интервалу, ВПЦ: среднее, медиана, n", ref("S2_Динамика"))
    if not has: draft_tag(s)
    blocks = [("Кс, открытый ствол", "bond_oh", 2), ("Кс, весь интервал", "bond_full", 2), ("ВПЦ: отклонение факт − план, м", "toc_dev", 0)]
    for i, (lab, key, nd) in enumerate(blocks):
        bx, by, bw, bh = 0.41, 1.72 + i * 1.62, 5.0, 1.45
        card_top(s, bx, by, bw, bh, color=GREEN if i < 2 else BLUE_L)
        text(s, bx + 0.15, by + 0.13, bw - 0.3, 0.3, lab, size=11, bold=True, color=NAVY)
        rows = [[H("", fill=CARD), H("Среднее", fill=CARD), H("Медиана", fill=CARD), H("n", fill=CARD), H("Мин – макс", fill=CARD)]]
        for r_ in rows[0]:
            r_["color"] = GREY
        for yr in ("2025", "2026"):
            st = g(M, "overall", yr, key) or {}
            agg = g(M, "overall", yr, "source") == "published_aggregate"
            f = (lambda v: fnum(v, nd)) if nd else fm
            rows.append([dict(t=yr + (" (агрегат)" if agg else ""), fill=CARD, color=BLUE_L if yr == "2025" else GREEN_D, bold=True, size=10, align=PP_ALIGN.LEFT),
                         VAL(f(st.get("mean")), fill=CARD, size=11, bold=True), VAL(ND if agg else f(st.get("median")), fill=CARD, size=11),
                         VAL(fint(st.get("n")), fill=CARD), VAL(ND if agg or st.get("min") is None else f"{f(st.get('min'))} – {f(st.get('max'))}", fill=CARD)])
        table(s, bx + 0.12, by + 0.45, bw - 0.24, [1.2, 0.95, 0.95, 0.6, 1.06], rows, [0.26, 0.34, 0.34])
    # Диаграмма: среднее и медиана по годам
    cx_, cy_, cw_, chh = 5.65, 1.72, 7.28, 4.7
    rect(s, cx_, cy_, cw_, chh, fill=WHITE, line=CARD)
    text(s, cx_ + 0.15, cy_ + 0.1, cw_ - 0.3, 0.3, "Коэффициент сцепления: среднее и медиана", size=10.5, bold=True, color=NAVY)
    cd = CategoryChartData()
    cd.categories = ["Открытый ствол", "Весь интервал"]
    for nm, yr, stat in (("2025 · среднее", "2025", "mean"), ("2025 · медиана", "2025", "median"), ("2026 · среднее", "2026", "mean"), ("2026 · медиана", "2026", "median")):
        cd.add_series(nm, [g(M, "overall", yr, k, stat) for k in ("bond_oh", "bond_full")])
    gf = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(cx_ + 0.1), Inches(cy_ + 0.45), Inches(cw_ - 0.2), Inches(chh - 0.55), cd)
    c = gf.chart
    chart_base(c)
    color_series(c, [BLUE_L, MED_2025, GREEN_D, MED_2026])
    c.value_axis.minimum_scale = 0
    c.value_axis.maximum_scale = 1
    c.value_axis.tick_labels.number_format = "0.0"
    c.value_axis.tick_labels.number_format_is_linked = False
    if not has: empty_overlay(s, cx_ + 0.6, cy_ + 0.5, cw_ - 0.8, chh - 1.2)
    note(s, 0.41, 6.55, 12.52, 0.4, "Пороги «хорошо/плохо» 0,80 и 0,90 не наносятся, пока утверждённый критерий не подтверждён. "
         "Если за 2025 г. есть только опубликованные агрегаты, медиана и разброс 2025 — «н/д». Положительное отклонение ВПЦ = недоподъём.", size=8.5)

    # ---------- 3. Тип скважины × колонна ----------
    s = content_slide(prs, "Тип скважины × назначение колонны", "Наклонно направленные и горизонтальные скважины: сцепление и ВПЦ по колоннам", ref("S3_Тип_Колонна"))
    if not has: draft_tag(s)
    kinds = [("tech", "Техническая"), ("prod", "Эксплуатационная"), ("liner", "Хвостовик цементируемый")]
    rows = [
        [H("Колонна", fill=TBL_HEAD), H("n колонн", span=2), H("Кс, открытый ствол · ср. / мед.", span=2), H("Кс, весь интервал · ср. / мед.", span=2), H("ВПЦ 2026", span=2)],
        [H(""), H("2025"), H("2026"), H("2025"), H("2026"), H("2025"), H("2026"), H("пар n"), H("откл., мед., м")],
    ]
    for prof, pname in (("nn", "Наклонно направленные скважины"), ("gs", "Горизонтальные скважины")):
        rows.append([GROUP(pname, 9)])
        for k, kn in kinds:
            r_ = [LBL(kn)]
            for yr in ("2025", "2026"):
                r_.append(VAL(fint(g(M, "by_type", yr, prof, k, "n"))))
            for key in ("bond_oh", "bond_full"):
                for yr in ("2025", "2026"):
                    st = g(M, "by_type", yr, prof, k, key) or {}
                    r_.append(HEATC(st.get("mean"), st.get("median"), st.get("n")))
            tp = g(M, "by_type", "2026", prof, k, "toc_dev") or {}
            r_.append(VAL(fint(tp.get("n"))))
            dev = tp.get("median")
            r_.append(VAL(fm(dev), color=UNDER if (dev or 0) > 0 else NAVY, bold=dev is not None))
            rows.append(r_)
    table(s, 0.41, 1.72, 12.52, [2.3, 0.85, 0.85, 1.45, 1.45, 1.45, 1.45, 0.85, 1.87], rows,
          [0.4, 0.28, 0.3, 0.52, 0.52, 0.52, 0.3, 0.52, 0.52, 0.52])
    note(s, 0.41, 6.3, 8.6, 0.6, "Колонна классифицируется по назначению и фактической конструкции скважины, а не по диаметру. "
         f"Нецементируемые хвостовики исключены из оценки качества: {fint(g(M, 'excluded', 'uncemented_liners'))} колонн. "
         "Цвет ячейки — шкала среднего значения, не критерий «хорошо/плохо».", size=8.5)
    legend_heat(s, 9.2, 6.3)

    # ---------- 4. Месторождения: общая картина ----------
    s = content_slide(prs, "Месторождения: общая картина", "Качество цементирования и полнота данных по месторождениям и годам", ref("S4_Месторождения"))
    if not has: draft_tag(s)
    fields = g(M, "fields") or ["‹месторождение 1›", "‹месторождение 2›", "‹месторождение 3›"]
    cx_, cy_, cw_, chh = 0.41, 1.72, 6.0, 4.75
    rect(s, cx_, cy_, cw_, chh, fill=WHITE, line=CARD)
    text(s, cx_ + 0.15, cy_ + 0.1, cw_ - 0.3, 0.3, "Кс, весь интервал: среднее по месторождениям", size=10.5, bold=True, color=NAVY)
    cd = CategoryChartData()
    cd.categories = list(reversed(fields))
    for yr in ("2025", "2026"):
        cd.add_series(yr, [g(M, "by_field", yr, f, "bond_full", "mean") for f in reversed(fields)])
    gf = s.shapes.add_chart(XL_CHART_TYPE.BAR_CLUSTERED, Inches(cx_ + 0.1), Inches(cy_ + 0.45), Inches(cw_ - 0.2), Inches(chh - 0.55), cd)
    c = gf.chart
    chart_base(c)
    color_series(c, [BLUE_L, GREEN_D])
    c.value_axis.minimum_scale = 0
    c.value_axis.maximum_scale = 1
    c.value_axis.tick_labels.number_format = "0.0"
    c.value_axis.tick_labels.number_format_is_linked = False
    if not has: empty_overlay(s, cx_ + 1.5, cy_ + 0.5, cw_ - 1.7, chh - 1.2)
    rows = [[H("Месторождение"), H("Скважин\n2025 / 2026"), H("Колонн с\nпригодной АКЦ"), H("Пар ВПЦ\nплан/факт"), H("SRTi\nизвестен")]]
    for f in fields:
        r_ = [LBL(f)]
        r_.append(VAL(f"{fint(g(M, 'by_field', '2025', f, 'wells'))} / {fint(g(M, 'by_field', '2026', f, 'wells'))}"))
        r_.append(VAL(fpct(g(M, "by_field", "2026", f, "strings_akc_valid"), g(M, "by_field", "2026", f, "strings_cemented"))))
        r_.append(VAL(fpct(g(M, "by_field", "2026", f, "toc_pairs"), g(M, "by_field", "2026", f, "strings_cemented"))))
        r_.append(VAL(fpct(g(M, "by_field", "2026", f, "srti_known"), g(M, "by_field", "2026", f, "strings_cemented"))))
        rows.append(r_)
    text(s, 6.65, 1.72, 6.28, 0.3, "Полнота данных 2026, % от цементируемых колонн", size=10.5, bold=True, color=NAVY)
    table(s, 6.65, 2.08, 6.28, [2.0, 1.1, 1.1, 1.04, 1.04], rows, [0.5] + [0.42] * len(fields))
    note(s, 6.65, 2.08 + 0.5 + 0.42 * len(fields) + 0.15, 6.28, 0.9,
         "Месторождения — по реестру, без объединения похожих названий. Группы с n < 3 показываются, но не сравниваются. "
         "2025 — только при наличии построчных данных; иначе «н/д».", size=8.5)

    # ---------- 5. Месторождение × тип × колонна: сцепление ----------
    s = content_slide(prs, "Сцепление: месторождение × тип × колонна", "2026: среднее / медиана и n; открытый ствол и весь интервал — раздельно", ref("S5_Сцепление_разрез"))
    if not has: draft_tag(s)
    rows = [[H("Месторождение · тип"), H("Техническая", span=2), H("Эксплуатационная", span=2), H("Хвостовик цем.", span=2)],
            [H(""), H("Открытый ствол"), H("Весь интервал"), H("Открытый ствол"), H("Весь интервал"), H("Открытый ствол"), H("Весь интервал")]]
    for f in fields:
        rows.append([GROUP(f, 7)])
        for prof, pn in (("nn", "НН"), ("gs", "ГС")):
            r_ = [LBL(pn)]
            for k, _ in kinds:
                for key in ("bond_oh", "bond_full"):
                    st = g(M, "by_field_type", "2026", f, prof, k, key) or {}
                    r_.append(HEATC(st.get("mean"), st.get("median"), st.get("n")))
            rows.append(r_)
    rh = [0.36, 0.28] + [0.26 if len(r) == 1 else 0.45 for r in rows[2:]]
    table(s, 0.41, 1.72, 12.52, [1.9] + [1.77] * 6, rows, rh)
    legend_heat(s, 9.2, 6.3)
    note(s, 0.41, 6.3, 8.6, 0.6, "НН — наклонно направленная, ГС — горизонтальная скважина. «н/д» — нет валидного замера; "
         "значения не восстанавливаются. Сравнение 2025 → 2026 в том же разрезе — лист S5, если есть построчные данные 2025 г.", size=8.5)

    # ---------- 6. Месторождение × тип × колонна: ВПЦ ----------
    s = content_slide(prs, "ВПЦ: месторождение × тип × колонна", "2026: план, факт, отклонение и число сопоставимых пар измерений", ref("S6_ВПЦ_разрез"))
    if not has: draft_tag(s)
    rows = [[H("Месторождение · тип")] + [H(kn, span=4) for _, kn in kinds],
            [H("")] + [H(t) for _ in kinds for t in ("пар n", "план, м", "факт, м", "откл., м")]]
    for f in fields:
        rows.append([GROUP(f, 13)])
        for prof, pn in (("nn", "НН"), ("gs", "ГС")):
            r_ = [LBL(pn)]
            for k, _ in kinds:
                st = g(M, "by_field_type", "2026", f, prof, k, "toc") or {}
                dev = st.get("dev_median")
                r_ += [VAL(fint(st.get("n"))), VAL(fint(st.get("plan_median"))), VAL(fint(st.get("fact_median"))),
                       VAL(fm(dev), color=UNDER if (dev or 0) > 0 else NAVY, bold=dev is not None)]
            rows.append(r_)
    rh = [0.36, 0.28] + [0.26 if len(r) == 1 else 0.4 for r in rows[2:]]
    table(s, 0.41, 1.72, 12.52, [1.78] + [0.85, 0.9, 0.9, 0.93] * 3, rows, rh)
    # конвенция знака
    card_top(s, 0.41, 5.85, 12.52, 0.95, color=BLUE_L)
    text(s, 0.56, 5.97, 12.2, 0.95, [
        ("Конвенция знака. ", {"bold": True}),
        ("Отклонение = глубина кровли цемента факт − глубина план (м, от одной точки отсчёта). Значение > 0 — ", {}),
        ("недоподъём", {"bold": True, "color": UNDER}),
        (", < 0 — подъём выше плана. План, факт и отклонение — медианы по сопоставимым парам. "
         "Отметка «устье» в числа не переводится без подтверждённой системы отсчёта; такие записи учитываются как несопоставимые.", {}),
    ], size=9.5, color=NAVY)

    # ---------- 7. Наихудшие операции ----------
    s = content_slide(prs, "Наихудшие операции", "Скважины и колонны: сцепление, недоподъём, зафиксированные осложнения", ref("S7_Худшие"))
    if not has: draft_tag(s)
    worst = g(M, "worst") or [{} for _ in range(6)]
    rows = [[H("№"), H("Скважина"), H("Куст"), H("Месторождение"), H("Тип"), H("Колонна, мм"), H("Кс ОС"), H("Кс ВИ"),
             H("Недоподъём, м"), H("Осложнения (бурение / цементирование)"), H("Валидность замера")]]
    for i, w in enumerate(worst, 1):
        dev = w.get("toc_dev")
        rows.append([VAL(str(i)), VAL(w.get("well", ND), bold=True), VAL(w.get("pad", ND)), VAL(w.get("field", ND)), VAL(w.get("profile", ND)),
                     VAL(w.get("string", ND)), HEATC(w.get("bond_oh"), None, None) if w.get("bond_oh") is not None else VAL(ND, fill=ND_FILL, color=GREY),
                     HEATC(w.get("bond_full"), None, None) if w.get("bond_full") is not None else VAL(ND, fill=ND_FILL, color=GREY),
                     VAL(fm(dev), color=UNDER if (dev or 0) > 0 else NAVY, bold=dev is not None),
                     dict(t=w.get("complications", ND), size=8.5, align=PP_ALIGN.LEFT),
                     VAL(w.get("validity", "валиден" if w else ND), size=8.5)])
    for rr in rows[1:]:
        for c_ in rr[6:8]:
            if c_.get("t", "").endswith("n = н/д"):
                c_["t"] = c_["t"].split(" / ")[0]
    table(s, 0.41, 1.72, 12.52, [0.35, 1.05, 0.7, 1.45, 0.55, 1.05, 0.8, 0.8, 1.1, 3.17, 1.5], rows, [0.48] + [0.42] * len(worst))
    # чувствительность
    by = 1.72 + 0.48 + 0.42 * len(worst) + 0.2
    card_top(s, 0.41, by, 12.52, 1.45, color=LIME)
    sens = g(M, "sensitivity") or {}
    text(s, 0.56, by + 0.12, 5.2, 0.3, "Расчёт чувствительности", size=10.5, bold=True, color=NAVY)
    text(s, 0.56, by + 0.45, 5.2, 0.95,
         "Исключаются только записи с подтверждённой в источниках технической невалидностью измерения. "
         "Поглощение при цементировании или осложнение при бурении сами по себе основанием не являются.",
         size=9, color=GREY)
    rows = [[H("Кс, весь интервал 2026"), H("n"), H("Среднее"), H("Медиана")],
            [LBL("Вся валидная выборка", fill=CARD)] + [VAL(v, fill=CARD) for v in (fint(g(sens, "all", "n")), fnum(g(sens, "all", "mean")), fnum(g(sens, "all", "median")))],
            [LBL(f"Без невалидных ({fint(g(sens, 'excluded_n'))} зап.)", fill=CARD)] + [VAL(v, fill=CARD) for v in (fint(g(sens, "clean", "n")), fnum(g(sens, "clean", "mean")), fnum(g(sens, "clean", "median")))]]
    table(s, 6.0, by + 0.15, 6.78, [3.0, 1.0, 1.39, 1.39], rows, [0.3, 0.32, 0.32])

    # ---------- 8. SRTi ----------
    s = content_slide(prs, "SRTi: сравнение в сопоставимых группах", "Только внутри группы «месторождение × профиль × колонна»; причинных выводов не делается", ref("S8_SRTi"))
    if not has: draft_tag(s)
    rows = [[H("Месторождение · профиль · колонна"), H("SRTi применялся", span=3), H("SRTi не применялся", span=3), H("Статус SRTi неизвестен", span=2)],
            [H(""), H("n"), H("Кс ОС, мед."), H("Кс ВИ, мед."), H("n"), H("Кс ОС, мед."), H("Кс ВИ, мед."), H("n"), H("доля, %")]]
    groups = g(M, "srti_groups") or [{"label": f"{f} · {p} · {k}"} for f in fields[:2] for p in ("НН", "ГС") for k in ("экспл.",)]
    for gr in groups:
        r_ = [LBL(gr["label"], size=8.5)]
        for kk in ("yes", "no"):
            st = gr.get(kk, {})
            r_ += [VAL(fint(st.get("n"))), VAL(fnum(st.get("bond_oh_median"))), VAL(fnum(st.get("bond_full_median")))]
        un = gr.get("unknown", {})
        r_ += [VAL(fint(un.get("n"))), VAL(fpct(un.get("n"), gr.get("total")))]
        rows.append(r_)
    table(s, 0.41, 1.72, 12.52, [3.2, 0.8, 1.2, 1.2, 0.8, 1.2, 1.2, 1.2, 1.72], rows, [0.36, 0.3] + [0.42] * len(groups))
    by = 1.72 + 0.66 + 0.42 * len(groups) + 0.25
    card_top(s, 0.41, by, 12.52, 1.0, color=BLUE_L)
    text(s, 0.56, by + 0.15, 12.2, 0.8, [
        ("Как читать. ", {"bold": True}),
        ("Показаны только группы, где есть скважины и с SRTi, и без него. Разница медиан — описательная: на результат одновременно влияют "
         "месторождение, профиль, колонна, подрядчик и технология, поэтому эффект SRTi из такого сравнения не выводится. "
         f"Записей с неизвестным статусом SRTi всего: {fint(g(M, 'srti_unknown_total'))} ({fpct(g(M, 'srti_unknown_total'), g(M, 'coverage', '2026', 'strings_cemented'))}).", {}),
    ], size=9.5, color=NAVY)

    # ---------- 9. Приложение: методика ----------
    s = content_slide(prs, "Приложение: методика и допущения", "Единые правила расчёта для всех слайдов", ref("M_Методика"))
    items = [
        ("01", "Единицы учёта", "Скважина — по году окончания бурения. Колонна — операция цементирования; дата АКЦ год не определяет. "
                                "Буровой подрядчик и подрядчик по цементированию учитываются раздельно."),
        ("02", "Коэффициент сцепления", "Открытый ствол и весь интервал считаются раздельно. Для группы — среднее, медиана, n, мин–макс; "
                                        "медиана — по всей валидной выборке."),
        ("03", "Валидность", "Исключение — только при подтверждённой технической невалидности замера, отдельным расчётом "
                             "чувствительности (какие записи, почему, изменение n / среднего / медианы)."),
        ("04", "ВПЦ", "Только пары план/факт от одной точки отсчёта. Отклонение = факт − план; > 0 — недоподъём. "
                      "«Устье» в число не переводится без подтверждения системы отсчёта."),
        ("05", "Колонны", "Классификация по назначению и фактической конструкции скважины, не по диаметру. "
                          "Нецементируемые хвостовики исключаются с указанием числа."),
        ("06", "Пороги и 2025 г.", "0,80 и 0,90 — оба показываются, пока критерий не подтверждён. Если за 2025 г. есть только "
                                   "опубликованные агрегаты — медиана и распределение не выводятся. Пустое — «н/д»."),
    ]
    for i, (num, head, body) in enumerate(items):
        bx, by = 0.41 + (i % 2) * 6.36, 1.72 + (i // 2) * 1.62
        rect(s, bx, by, 6.16, 1.45, fill=LIME_XL)
        rect(s, bx, by, 0.95, 1.45, fill=LIME_L)
        text(s, bx, by, 0.95, 1.45, num, size=26, color=GREEN_D, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, font=None)
        text(s, bx + 1.1, by + 0.12, 4.9, 0.3, head, size=11, bold=True, color=NAVY)
        text(s, bx + 1.1, by + 0.45, 4.9, 0.95, body, size=9, color=NAVY)

    # ---------- 10. Заключительный ----------
    s = prs.slides.add_slide(layout(prs, "44_Заголовок и объект"))
    set_ph(s, 0, "Спасибо за внимание")

    prs.save(out)
    return out


def legend_heat(s, x, y):
    text(s, x, y, 3.7, 0.22, "Шкала среднего Кс (цвет ≠ критерий):", size=8, color=GREY)
    items = [("≥ 0,90", GREEN_D), ("0,85", GREEN), ("0,80", LIME), ("0,70", LIME_L), ("< 0,70", LIME_XL), ("н/д", ND_FILL)]
    for i, (t, c) in enumerate(items):
        rect(s, x + i * 0.62, y + 0.27, 0.2, 0.16, fill=c, line=CARD)
        text(s, x + i * 0.62 + 0.23, y + 0.24, 0.4, 0.22, t, size=7.5, color=NAVY)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--metrics", default=os.path.join(ROOT, "data", "metrics.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "output", "Цементирование_РВП_2025-2026_проект.pptx"))
    a = ap.parse_args()
    M = json.load(open(a.metrics, encoding="utf-8")) if os.path.exists(a.metrics) else {}
    print(build(M, a.out))
