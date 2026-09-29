# -*- coding: utf-8 -*-
"""
Презентация «Качество цементирования обсадных колонн · 2026» на форме заказчика
(template/Форма_презентации.pptx). Все числа — из data/metrics.json (calc.py);
каждый слайд ссылается на лист книги output/Расчёт_цементирование_2026.xlsx.
"""
import json
import os

from pptx import Presentation
from pptx.chart.data import CategoryChartData, XyChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION, XL_MARKER_STYLE, XL_TICK_LABEL_POSITION, XL_TICK_MARK
from pptx.enum.dml import MSO_LINE_DASH_STYLE
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.oxml import parse_xml
from pptx.util import Inches, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FORM = os.path.join(ROOT, "template", "Форма_презентации.pptx")
ICONS = os.path.join(HERE, "assets", "icons")
M = json.load(open(os.path.join(ROOT, "data", "metrics.json"), encoding="utf-8"))

# ---------- палитра темы «Зарубежнефть» ----------
RGB = lambda h: RGBColor.from_string(h)
NAVY, NAVY_D, BLUE, BLUE_L = RGB("00326E"), RGB("001845"), RGB("005491"), RGB("0078AE")
GREEN_D, GREEN, LIME, LIME_L, LIME_XL = RGB("0A8F2D"), RGB("4BAF46"), RGB("9AC854"), RGB("CEE1A5"), RGB("EBF0D6")
TBL_HEAD, CARD, GREY, WHITE = RGB("009C3D"), RGB("E5EAF0"), RGB("5A5A5A"), RGB("FFFFFF")
ND_FILL, LINE_L = RGB("F2F4F7"), RGB("C9D3DE")
UNDER, OVER = RGB("C0392B"), RGB("0078AE")
STR_COL = {"tech": BLUE, "prod": GREEN_D, "liner": BLUE_L}          # идентичность колонн (проверено валидатором)
MET_COL = {"os": BLUE_L, "full": GREEN_D}                          # ОС / весь интервал
TFONT = "TT Bluescreens Pro Normal Mediu"                           # шрифт таблиц в форме
KEYS = [("tech", "Техническая", "245 мм"), ("prod", "Эксплуатационная", "168/178 мм"), ("liner", "Хвостовик", "114 мм")]
SHORT = {"tech": "Техн.", "prod": "Экспл.", "liner": "Хвост."}
ND = "н/д"


# ---------- формат чисел ----------
from decimal import Decimal, ROUND_HALF_UP


def _r(v, nd):
    """Округление как в Excel (половина — вверх по модулю, по десятичной записи числа)."""
    q = Decimal(1).scaleb(-nd)
    return Decimal(repr(v)).quantize(q, rounding=ROUND_HALF_UP)


def f2(v):
    return ND if v is None else str(_r(v, 2)).replace(".", ",")


def f3(v):
    return ND if v is None else (f"{v:.3f}".rstrip("0").rstrip(".") if abs(v * 100 - round(v * 100)) > 1e-9 else f"{v:.2f}").replace(".", ",")


def fm(v, sign=True):
    if v is None:
        return ND
    d = _r(v, 1)
    s = (("+" if d > 0 else "") + str(d)) if sign else str(d)
    s = s.replace(".", ",").replace("-", "−")
    if s.endswith(",0"):
        s = s[:-2]
    if s in ("+0", "−0"):
        s = "0"
    return s


def fi(v):
    return ND if v is None else f"{int(v):,}".replace(",", " ")


def rng(stt, f=f2):
    return ND if not stt or stt.get("min") is None else f"{f(stt['min'])}–{f(stt['max'])}"


# ---------- базовые операции ----------
def open_form():
    prs = Presentation(FORM)
    lst = prs.slides._sldIdLst
    ids = list(lst)
    for sid in ids[:-1]:                     # оставляем только заключительный слайд формы («Спасибо!»)
        prs.part.drop_rel(sid.rId)
        lst.remove(sid)
    # имя части сохранённого слайда не должно совпасть с именами новых слайдов
    from pptx.opc.packuri import PackURI
    prs.slides[0].part.partname = PackURI("/ppt/slides/slide999.xml")
    return prs


def layout(prs, name):
    return next(l for l in prs.slide_layouts if l.name == name)


def set_ph(slide, idx, text, size=None):
    ph = slide.placeholders[idx]
    tf = ph.text_frame
    lines = text.split("\n")
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = lines[0]
    if size:
        r.font.size = Pt(size)
    for ln in lines[1:]:
        p2 = tf.add_paragraph()
        r2 = p2.add_run()
        r2.text = ln
        if size:
            r2.font.size = Pt(size)
    return ph


def text(slide, x, y, w, h, runs, size=11, color=GREY, bold=False, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
         font=None, italic=False, margin=0.0, spacing=None):
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
    if spacing:
        p.space_after = Pt(spacing)
    for t, o in runs:
        for i, part in enumerate(t.split("\n")):
            if i > 0:
                p = tf.add_paragraph()
                p.alignment = align
                if spacing:
                    p.space_after = Pt(spacing)
            if not part:
                continue
            r = p.add_run()
            r.text = part
            fo = r.font
            fo.size = Pt(o.get("size", size))
            fo.bold = o.get("bold", bold)
            fo.italic = o.get("italic", italic)
            fnt = o.get("font", font)
            if fnt:
                fo.name = fnt
            fo.color.rgb = o.get("color", color)
    return tb


def rect(slide, x, y, w, h, fill=CARD, line=None, shape=MSO_SHAPE.RECTANGLE, lw=0.75, adj=None):
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
    if adj is not None:
        s.adjustments[0] = adj
    return s


def icon(slide, name, x, y, s=0.46):
    slide.shapes.add_picture(os.path.join(ICONS, f"{name}.png"), Inches(x), Inches(y), Inches(s), Inches(s))


def card(slide, x, y, w, h, top=GREEN):
    """Карточка формы: E5EAF0 + верхняя кромка 0,08″ цвета tx2."""
    rect(slide, x, y + 0.08, w, h - 0.08, fill=CARD)
    rect(slide, x, y, w, 0.08, fill=top)


def chevrons(slide, items, y=6.04, h=0.61, x0=0.41, w_total=12.52):
    """Полоса шевронов формы: первый — «пятиугольник», далее — шевроны."""
    cols = [BLUE, BLUE_L, GREEN_D, GREEN, LIME, LIME]
    n = len(items)
    ov = 0.12
    w = (w_total + ov * (n - 1)) / n
    for i, t in enumerate(items):
        shp = rect(slide, x0 + i * (w - ov), y, w, h, fill=cols[i % len(cols)],
                   shape=MSO_SHAPE.PENTAGON if i == 0 else MSO_SHAPE.CHEVRON)
        shp.adjustments[0] = 0.22
        tf = shp.text_frame
        tf.word_wrap = True
        tf.margin_left = Inches((0.22 if isinstance(t, tuple) else 0.28) if i else 0.1)
        tf.margin_right = Inches(0.12 if isinstance(t, tuple) else 0.2)
        tf.margin_top = tf.margin_bottom = 0
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        if isinstance(t, tuple):
            r = p.add_run(); r.text = t[0]; r.font.size = Pt(15); r.font.bold = True; r.font.color.rgb = WHITE
            p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.CENTER
            r2 = p2.add_run(); r2.text = t[1]; r2.font.size = Pt(8); r2.font.color.rgb = WHITE
        else:
            r = p.add_run(); r.text = t; r.font.size = Pt(10.5); r.font.color.rgb = WHITE


def content(prs, title, subtitle, sheet):
    s = prs.slides.add_slide(layout(prs, "8_Заголовок и объект"))
    set_ph(s, 0, title, 30)
    set_ph(s, 2, subtitle, 16)
    set_ph(s, 10, f"Качество цементирования 2026 · расчёт: лист «{sheet}»")
    return s


def note(slide, x, y, w, h, t, size=9):
    text(slide, x, y, w, h, t, size=size, color=GREY, italic=True)


# ---------- таблицы ----------
def table(slide, x, y, col_w, rows, row_h, font=TFONT):
    nrows, ncols = len(rows), len(col_w)
    heights = row_h if isinstance(row_h, list) else [row_h] * nrows
    gt = slide.shapes.add_table(nrows, ncols, Inches(x), Inches(y), Inches(sum(col_w)), Inches(sum(heights)))
    tbl = gt.table
    tblPr = tbl._tbl.tblPr
    tblPr.set("firstRow", "0")
    tblPr.set("bandRow", "0")
    sid = tblPr.find(qn("a:tableStyleId"))
    if sid is not None:
        sid.text = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}"
    for j, cw in enumerate(col_w):
        tbl.columns[j].width = Inches(cw)
    for i, row in enumerate(rows):
        tbl.rows[i].height = Inches(heights[i])
        j = 0
        for c in row:
            span = c.get("span", 1)
            cell = tbl.cell(i, j)
            if span > 1:
                cell.merge(tbl.cell(i, j + span - 1))
            cell.fill.solid()
            cell.fill.fore_color.rgb = c.get("fill", WHITE)
            cell.margin_left = cell.margin_right = Inches(0.05)
            cell.margin_top = cell.margin_bottom = Inches(0.01)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf = cell.text_frame
            tf.word_wrap = True
            for li, ln in enumerate(str(c.get("t", "")).split("\n")):
                p = tf.paragraphs[0] if li == 0 else tf.add_paragraph()
                p.alignment = c.get("align", PP_ALIGN.CENTER)
                r = p.add_run()
                r.text = ln
                r.font.size = Pt(c.get("size", 9) if li == 0 else c.get("size2", max(c.get("size", 9) - 2, 7)))
                r.font.bold = c.get("bold", False) if li == 0 else False
                r.font.name = font
                r.font.color.rgb = c.get("color", NAVY)
            j += span
    for tc in tbl._tbl.iter(qn("a:tc")):
        tcPr = tc.get_or_add_tcPr()
        for tag in ("a:lnL", "a:lnR", "a:lnT", "a:lnB"):
            old = tcPr.find(qn(tag))
            if old is not None:
                tcPr.remove(old)
        for tag in ("lnB", "lnT", "lnR", "lnL"):
            tcPr.insert(0, parse_xml(f'<a:{tag} xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" w="{int(Pt(1.25))}">'
                                     f'<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:{tag}>'))
    return tbl


H = lambda t, span=1, size=8.5, fill=TBL_HEAD: dict(t=t, span=span, fill=fill, color=WHITE, bold=True, size=size)
G = lambda t, span: dict(t=t, span=span, fill=NAVY, color=WHITE, bold=True, size=9, align=PP_ALIGN.LEFT)
LB = lambda t, fill=WHITE, size=9, bold=False: dict(t=t, fill=fill, color=NAVY, size=size, bold=bold, align=PP_ALIGN.LEFT)
V = lambda t, fill=WHITE, color=NAVY, size=9, bold=False: dict(t=t, fill=fill, color=color, size=size, bold=bold)

HEAT = [(0.90, GREEN_D, WHITE), (0.80, GREEN, WHITE), (0.70, LIME, NAVY), (0.60, LIME_L, NAVY), (-1, LIME_XL, NAVY)]


def heat(v):
    if v is None:
        return ND_FILL, GREY
    return next((b, f) for t, b, f in HEAT if v >= t)


def heat_legend(slide, x, y):
    text(slide, x, y, 4.2, 0.22, "Цвет — медиана Кобщ (шкала, не критерий «хорошо/плохо»):", size=8, color=GREY)
    items = [("≥ 0,90", GREEN_D), ("0,80–0,90", GREEN), ("0,70–0,80", LIME), ("0,60–0,70", LIME_L), ("< 0,60", LIME_XL), ("н/д", ND_FILL)]
    for i, (t, c) in enumerate(items):
        rect(slide, x + i * 0.86, y + 0.27, 0.18, 0.15, fill=c, line=LINE_L, lw=0.5)
        text(slide, x + i * 0.86 + 0.21, y + 0.23, 0.64, 0.22, t, size=7.5, color=NAVY)


# ---------- диаграммы ----------
def chart_frame(ch, legend=False, size=9):
    ch.has_title = False
    ch.font.size = Pt(size)
    ch.font.name = TFONT
    ch.font.color.rgb = GREY
    ch.has_legend = legend
    if legend:
        ch.legend.position = XL_LEGEND_POSITION.BOTTOM
        ch.legend.include_in_layout = False
        ch.legend.font.size = Pt(size)


def quiet_axes(ch, val_fmt="0.0", vmin=None, vmax=None, major=None):
    va = ch.value_axis
    va.has_major_gridlines = True
    va.major_gridlines.format.line.color.rgb = RGB("E3E8EE")
    va.major_gridlines.format.line.width = Pt(0.5)
    va.format.line.fill.background()
    va.tick_labels.font.size = Pt(8)
    va.tick_labels.number_format = val_fmt
    va.tick_labels.number_format_is_linked = False
    va.major_tick_mark = XL_TICK_MARK.NONE
    if vmin is not None:
        va.minimum_scale = vmin
    if vmax is not None:
        va.maximum_scale = vmax
    if major:
        va.major_unit = major
    ca = ch.category_axis
    ca.format.line.color.rgb = LINE_L
    ca.major_tick_mark = XL_TICK_MARK.NONE
    ca.has_major_gridlines = False


def plot_layout(ch, x, y, w, h):
    pa = ch._chartSpace.chart.plotArea
    old = pa.find(qn("c:layout"))
    if old is not None:
        pa.remove(old)
    pa.insert(0, parse_xml(
        '<c:layout xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:manualLayout>'
        '<c:layoutTarget val="inner"/><c:xMode val="edge"/><c:yMode val="edge"/>'
        f'<c:x val="{x}"/><c:y val="{y}"/><c:w val="{w}"/><c:h val="{h}"/></c:manualLayout></c:layout>'))


def bar_series_style(ch, colors, fmt="0.00", labels=True, gap=70, overlap=-5, lab_size=9):
    pl = ch.plots[0]
    pl.gap_width = gap
    pl.overlap = overlap
    for s, c in zip(pl.series, colors):
        s.format.fill.solid()
        s.format.fill.fore_color.rgb = c
        s.format.line.fill.background()
        s.invert_if_negative = False
    if labels:
        pl.has_data_labels = True
        dl = pl.data_labels
        dl.number_format = fmt
        dl.number_format_is_linked = False
        dl.position = XL_LABEL_POSITION.OUTSIDE_END
        dl.font.size = Pt(lab_size)
        dl.font.color.rgb = NAVY


# =====================================================================
def build(out):
    prs = open_form()
    cov = M["coverage"]
    BS = M["by_string"]
    under_total = sum(BS[k]["toc"]["under_n"] for k, *_ in KEYS)
    pairs_total = cov["toc_pairs"]

    # ---------- 1. Титульный ----------
    s = prs.slides.add_slide(layout(prs, "1_Титульный слайд"))
    set_ph(s, 0, "Качество цементирования обсадных колонн")
    set_ph(s, 13, "СП «Русвьетпетро» · скважины 2026 г.\nАКЦ и высота подъёма цемента")
    pill = rect(s, 0.41, 6.72, 1.54, 0.38, fill=WHITE, line=NAVY, shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.5)
    tf = pill.text_frame
    tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = "29.09.2026"; r.font.size = Pt(12); r.font.color.rgb = NAVY

    # ---------- 2. Главное ----------
    s = content(prs, "Главное", f"{cov['wells']} скважин, законченных бурением в 2026 г. · {cov['strings_cemented']} цементируемых колонн · 2025 г. — данных нет", "S2_Колонны")
    pr, ln, th = BS["prod"], BS["liner"], BS["tech"]
    worst2 = M["worst_toc"][:2]
    thp = M["thresholds"]["prod_full"]
    cards = [
        ("down", "Эксплуатационная колонна — слабое звено", f2(pr["bond_full"]["median"]), "медиана Кобщ по всему интервалу",
         f"Среднее {f2(pr['bond_full']['mean'])}, разброс {rng(pr['bond_full'])}. В открытом стволе медиана {f2(pr['bond_oh']['median'])}. "
         f"Не ниже 0,80 — {thp['ge80']} из {thp['n']} колонн (справочно).",
         f"n = {pr['bond_full']['n']} колонн; без АКЦ — {pr['n_strings'] - pr['bond_full']['n']}"),
        ("alert", "Недоподъём цемента", f"{under_total} из {pairs_total}", "пар ВПЦ: кровля цемента глубже плана",
         "Наибольший: " + "; ".join(f"{w['well']} ({SHORT[[k for k, n, _ in KEYS if n == w['string']][0]].lower()}) — {fm(w['dev'], False)} м" for w in worst2) +
         f". По эксплуатационным колоннам — {pr['toc']['under_n']} из {pr['toc']['n']} пар.",
         "Отклонение = факт − план; > 0 — недоподъём"),
        ("ok", "Хвостовики НН — лучшее качество", f2(ln["bond_full"]["median"]), "медиана Кобщ по всему интервалу",
         f"В открытом стволе медиана {f2(ln['bond_oh']['median'])}. ВПЦ: отклонения {fm(ln['toc']['min'])}…{fm(ln['toc']['max'])} м "
         f"({ln['toc']['n']} пар).", f"n = {ln['bond_full']['n']}; без АКЦ — {ln['n_strings'] - ln['bond_full']['n']}; ГС: хвостовик «н/ц»"),
        ("dataoff", "Ограничения данных", "н/д", "2025 г., SRTi, осложнения",
         f"Нет данных 2025 г., SRTi, осложнений, дат АКЦ и подрядчика по цементированию. Без АКЦ — {cov['strings_akc_missing']} из "
         f"{cov['strings_cemented']} колонн; {cov['wells_nodate']} записи без даты окончания бурения.",
         "Порог 0,80 / 0,90 не утверждён"),
    ]
    for i, (ic, head, big, lab, body, box) in enumerate(cards):
        x = 0.41 + i * 3.18
        card(s, x, 1.63, 2.98, 4.2, top=[BLUE, GREEN_D, GREEN, LIME][i])
        icon(s, ic, x + 0.16, 1.86, 0.46)
        text(s, x + 0.75, 1.82, 2.1, 0.6, head, size=13, color=GREEN, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 0.16, 2.5, 2.7, 0.62, big, size=30, color=NAVY, bold=True)
        text(s, x + 0.16, 3.1, 2.7, 0.3, lab, size=9.5, color=NAVY)
        text(s, x + 0.16, 3.45, 2.66, 1.5, body, size=10, color=GREY)
        rect(s, x + 0.12, 5.02, 2.74, 0.68, fill=WHITE)
        text(s, x + 0.2, 5.02, 2.6, 0.68, [("Основа: ", {"bold": True}), (box, {})], size=9.5, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
    chevrons(s, ["Для сравнения 2025 → 2026:", "построчные данные 2025 г.", "SRTi и осложнения в реестре", "даты АКЦ, подрядчик цементирования", "утверждённый критерий Кобщ"])

    # ---------- 3. Охват анализа ----------
    s = content(prs, "Охват анализа", "Скважины, законченные бурением в 2026 г., колонны и пригодность оценки АКЦ · 2025 г. — н/д", "S1_Охват")
    tiles = [
        (fi(cov["registry_wells"]), "записей в реестре 2026", "db"),
        (fi(cov["wells"]), f"скважин закончено бурением в 2026 г.\nНН — {cov['wells_nn']}, ГС — {cov['wells_gs']}", "check"),
        (fi(cov["wells_nodate"]), "записи без даты окончания бурения —\nвне базы, в расчёте чувствительности", "alert"),
    ]
    for i, (v, lab, ic) in enumerate(tiles):
        y = 1.63 + i * 1.42
        card(s, 0.41, y, 3.55, 1.28, top=[BLUE, GREEN_D, LIME][i])
        icon(s, ic, 0.58, y + 0.3, 0.42)
        text(s, 1.15, y + 0.2, 1.3, 0.6, v, size=30, bold=True, color=NAVY)
        text(s, 1.15, y + 0.78, 2.75, 0.45, lab, size=9, color=GREY)
    # 2025
    rect(s, 0.41, 5.9 - 0.02, 3.55, 0.55, fill=WHITE, line=LINE_L)
    text(s, 0.52, 5.88, 3.35, 0.55, [("2025 г.: н/д. ", {"bold": True, "color": NAVY}), ("Построчные данные и опубликованные агрегаты не предоставлены.", {})],
         size=9, anchor=MSO_ANCHOR.MIDDLE)
    # статус колонн — сложенные столбики
    text(s, 4.2, 1.63, 8.7, 0.3, "Цементируемые колонны базы 2026: наличие оценки АКЦ", size=12, color=NAVY, bold=True)
    cats, have, nd = [], [], []
    for k, n, d in KEYS:
        tot = len([o for o in M["points"] if o["key"] == k])  # цементируемые
        h_ = BS[k]["bond_full"]["n"]
        cats.append(f"{n}\n{d}")
        have.append(h_)
        nd.append(tot - h_)
    unc = {"tech": 0, "prod": 0, "liner": cov["strings_uncemented"]}
    cd = CategoryChartData()
    cd.categories = cats
    cd.add_series("Кобщ есть", have)
    cd.add_series("АКЦ н/д", nd)
    cd.add_series("Не цементировалась («н/ц»)", [unc[k] for k, *_ in KEYS])
    gf = s.shapes.add_chart(XL_CHART_TYPE.BAR_STACKED, Inches(4.15), Inches(1.95), Inches(5.3), Inches(3.3), cd)
    ch = gf.chart
    chart_frame(ch, legend=True)
    quiet_axes(ch, "0", vmin=0, vmax=20, major=5)
    ch.category_axis.reverse_order = True
    ch.category_axis.tick_labels.font.size = Pt(9)
    ch.category_axis.tick_labels.font.color.rgb = NAVY
    ch.value_axis.tick_label_position = XL_TICK_LABEL_POSITION.LOW
    pl = ch.plots[0]
    pl.gap_width = 55
    pl.overlap = 100
    for srs, c in zip(pl.series, [GREEN_D, RGB("B8C2CE"), LIME_L]):
        srs.format.fill.solid(); srs.format.fill.fore_color.rgb = c
    pl.has_data_labels = True
    pl.data_labels.position = XL_LABEL_POSITION.CENTER
    pl.data_labels.font.size = Pt(10)
    pl.data_labels.font.bold = True
    pl.data_labels.font.color.rgb = WHITE
    pl.data_labels.number_format = '0;;;'
    pl.data_labels.number_format_is_linked = False
    # таблица полноты
    rows = [[H("Колонна"), H("Всего"), H("Кобщ ОС"), H("Кобщ весь"), H("Пар ВПЦ")]]
    for k, n, d in KEYS:
        b = BS[k]
        rows.append([LB(n, fill=CARD), V(fi(b["n_strings"]), fill=CARD), V(fi(b["bond_oh"]["n"]), fill=CARD),
                     V(fi(b["bond_full"]["n"]), fill=CARD), V(fi(b["toc"]["n"]), fill=CARD)])
    rows.append([LB("Итого", bold=True), V(fi(cov["strings_cemented"]), bold=True), V(fi(cov["strings_akc_oh"]), bold=True),
                 V(fi(cov["strings_akc_full"]), bold=True), V(fi(cov["toc_pairs"]), bold=True)])
    text(s, 9.65, 1.95, 3.28, 0.3, "Полнота по колоннам", size=10.5, bold=True, color=NAVY)
    table(s, 9.65, 2.28, [1.2, 0.5, 0.5, 0.55, 0.53], rows, [0.42, 0.34, 0.34, 0.34, 0.34])
    note(s, 9.65, 4.15, 3.28, 1.1, f"«н/ц» — хвостовики всех {cov['wells_gs']} ГС: исключены из оценки качества. "
         f"АКЦ н/д: «Не писали» — {M['akc_missing_by_status'].get('АКЦ не записан', 0)}, «нет инф» — {M['akc_missing_by_status'].get('нет информации', 0)}.", size=8.5)
    chevrons(s, [(fi(cov["registry_wells"]), "записей реестра"), (fi(cov["wells"]), "скв. 2026 г."), (fi(cov["strings_total"]), "колонн всего"),
                 (fi(cov["strings_cemented"]), "в оценке"), (fi(cov["strings_akc_full"]), "с Кобщ (АКЦ)"), (fi(cov["toc_pairs"]), "пар ВПЦ")],
             y=5.62, h=0.8, x0=4.15, w_total=8.78)

    # ---------- 4. Итоги 2026 по колоннам ----------
    s = content(prs, "Итоги 2026 по колоннам", "Кобщ в открытом стволе и по всему интервалу: каждая точка — колонна; линия — медиана", "S2_Колонны")
    X = {("tech", "os"): 1.0, ("tech", "full"): 1.75, ("prod", "os"): 3.15, ("prod", "full"): 3.9, ("liner", "os"): 5.3, ("liner", "full"): 6.05}
    xmin, xmax, vmin, vmax = 0.35, 6.75, 0.0, 1.05
    cd = XyChartData()
    ser = {"os": cd.add_series("Открытый ствол"), "full": cd.add_series("Весь интервал")}
    for (k, m_), xc in X.items():
        vals = sorted([p[m_] for p in M["points"] if p["key"] == k and p[m_] is not None])
        for i, v in enumerate(vals):
            ser[m_].add_data_point(xc + ((i % 5) - 2) * 0.07, v)
    meds = []
    for (k, m_), xc in X.items():
        md = BS[k]["bond_oh" if m_ == "os" else "bond_full"]["median"]
        srs = cd.add_series(f"Медиана {k} {m_}")
        srs.add_data_point(xc - 0.27, md); srs.add_data_point(xc + 0.27, md)
        meds.append((xc, md))
    for v in (0.8, 0.9):
        srs = cd.add_series(f"{v} справочно")
        srs.add_data_point(xmin, v); srs.add_data_point(xmax, v)
    CX, CY, CW, CH = 0.41, 1.95, 7.55, 4.6
    PL = (0.07, 0.02, 0.91, 0.76)
    gf = s.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER, Inches(CX), Inches(CY), Inches(CW), Inches(CH), cd)
    ch = gf.chart
    chart_frame(ch, legend=False)
    plot_layout(ch, *PL)
    quiet_axes(ch, "0.0", vmin=vmin, vmax=vmax, major=0.1)
    xa = ch.category_axis
    xa.minimum_scale, xa.maximum_scale = xmin, xmax
    xa.tick_label_position = XL_TICK_LABEL_POSITION.NONE
    xa.has_major_gridlines = False
    xa.format.line.color.rgb = LINE_L
    sers = list(ch.plots[0].series)
    for srs in sers:
        srs.smooth = False
    for srs, c in ((sers[0], MET_COL["os"]), (sers[1], MET_COL["full"])):
        srs.format.line.fill.background()
        srs.marker.style = XL_MARKER_STYLE.CIRCLE
        srs.marker.size = 8
        srs.marker.format.fill.solid(); srs.marker.format.fill.fore_color.rgb = c
        srs.marker.format.line.color.rgb = WHITE
    for srs in sers[2:8]:
        srs.marker.style = XL_MARKER_STYLE.NONE
        srs.format.line.color.rgb = NAVY; srs.format.line.width = Pt(3)
    for srs, dash in ((sers[8], MSO_LINE_DASH_STYLE.DASH), (sers[9], MSO_LINE_DASH_STYLE.SQUARE_DOT)):
        srs.marker.style = XL_MARKER_STYLE.NONE
        srs.format.line.color.rgb = RGB("8A96A6"); srs.format.line.width = Pt(1); srs.format.line.dash_style = dash
    px = lambda xv: CX + CW * (PL[0] + PL[2] * (xv - xmin) / (xmax - xmin))
    py = lambda yv: CY + CH * (PL[1] + PL[3] * (1 - (yv - vmin) / (vmax - vmin)))
    for xc, md in meds:                                   # подписи медиан справа от линии
        tb = text(s, px(xc + 0.29), py(md) - 0.11, 0.42, 0.22, f2(md), size=9, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE, margin=0.02)
        tb.fill.solid(); tb.fill.fore_color.rgb = WHITE
    for v, lab in ((0.8, "0,80"), (0.9, "0,90")):
        text(s, px(xmin) + 0.04, py(v) - 0.19, 0.5, 0.18, lab, size=7.5, color=GREY)
    ybase = CY + CH * (PL[1] + PL[3]) + 0.04
    for k, n, d in KEYS:
        for m_, lab in (("os", "ОС"), ("full", "весь")):
            nn = BS[k]["bond_oh" if m_ == "os" else "bond_full"]["n"]
            text(s, px(X[(k, m_)]) - 0.4, ybase, 0.8, 0.36, f"{lab}\nn = {nn}", size=8, color=GREY, align=PP_ALIGN.CENTER)
        xc = (X[(k, "os")] + X[(k, "full")]) / 2
        text(s, px(xc) - 1.25, ybase + 0.38, 2.5, 0.26, f"{n} · {d}", size=9.5, bold=True, color=STR_COL[k], align=PP_ALIGN.CENTER)
    # легенда (вручную — без служебных рядов)
    lx, ly = 0.5, 1.66
    for c, t in ((MET_COL["os"], "открытый ствол"), (MET_COL["full"], "весь интервал")):
        rect(s, lx, ly + 0.05, 0.13, 0.13, fill=c, shape=MSO_SHAPE.OVAL)
        text(s, lx + 0.18, ly, 1.3, 0.24, t, size=9, color=NAVY)
        lx += 1.45
    rect(s, lx, ly + 0.1, 0.32, 0.04, fill=NAVY)
    text(s, lx + 0.38, ly, 0.9, 0.24, "медиана", size=9, color=NAVY)
    lx += 1.2
    ln_ = s.shapes.add_connector(1, Inches(lx), Inches(ly + 0.12), Inches(lx + 0.32), Inches(ly + 0.12))
    ln_.line.color.rgb = RGB("8A96A6"); ln_.line.dash_style = MSO_LINE_DASH_STYLE.DASH; ln_.line.width = Pt(1)
    text(s, lx + 0.38, ly, 2.4, 0.24, "0,80 / 0,90 — справочно", size=9, color=GREY)
    # таблица статистик
    rows = [[H("Колонна · показатель"), H("n"), H("Среднее"), H("Медиана"), H("Мин–макс")]]
    for k, n, d in KEYS:
        rows.append([G(n, 5)])
        for m_, lab in (("bond_oh", "Кобщ ОС"), ("bond_full", "Кобщ весь")):
            stt = BS[k][m_]
            rows.append([LB(lab, size=8.5), V(fi(stt["n"]), size=8.5), V(f2(stt["mean"]), size=8.5), V(f2(stt["median"]), bold=True, size=8.5), V(rng(stt), size=8.5)])
        t = BS[k]["toc"]
        rows.append([LB("ВПЦ: пар · недоподъём", fill=CARD, size=8.5), V(fi(t["n"]), fill=CARD, size=8.5),
                     V(f"{t['under_n']}", fill=CARD, color=UNDER if t["under_n"] else NAVY, bold=bool(t["under_n"]), size=8.5),
                     V(f"{fm(t['median'])} м", fill=CARD, size=8.5), V(f"{fm(t['min'])}…{fm(t['max'])} м", fill=CARD, size=8.5)])
    table(s, 8.2, 1.63, [1.55, 0.42, 0.72, 0.72, 1.31], rows, [0.3] + [0.235] * 12)
    ty = 1.63 + 0.3 + 0.235 * 12 + 0.12
    text(s, 8.2, ty, 4.72, 0.26, "Медиана Кобщ (весь интервал) по кварталу окончания бурения", size=9, bold=True, color=NAVY)
    cd = CategoryChartData()
    qs = M["quarters"]
    cd.categories = [q.replace(" 2026", "") + f" ({M['by_quarter'][q]['wells']} скв.)" for q in qs]
    for k, n, d in KEYS:
        cd.add_series(n, [M["by_quarter"][q][k]["bond_full"]["median"] for q in qs])
    gf = s.shapes.add_chart(XL_CHART_TYPE.LINE_MARKERS, Inches(8.1), Inches(ty + 0.24), Inches(4.85), Inches(6.6 - ty - 0.24), cd)
    ch = gf.chart
    chart_frame(ch, legend=True, size=8)
    quiet_axes(ch, "0.0", vmin=0.5, vmax=1.0, major=0.1)
    ch.category_axis.tick_labels.font.size = Pt(8)
    for srs, (k, *_ ) in zip(ch.plots[0].series, KEYS):
        srs.smooth = False
        srs.format.line.color.rgb = STR_COL[k]; srs.format.line.width = Pt(2)
        srs.marker.style = XL_MARKER_STYLE.CIRCLE; srs.marker.size = 7
        srs.marker.format.fill.solid(); srs.marker.format.fill.fore_color.rgb = STR_COL[k]
        srs.marker.format.line.color.rgb = WHITE
    note(s, 0.41, 6.62, 12.5, 0.3, "Пороги 0,80 и 0,90 — справочно: утверждённый критерий не подтверждён. Динамика по кварталам — описательная, "
         "малые n (3–10 скважин). 2025 г. — данных нет.", size=8.5)

    # ---------- 5. Тип скважины × колонна ----------
    s = content(prs, "Тип скважины × колонна", "Наклонно направленные (НН) и горизонтальные (ГС) скважины: медианы Кобщ и ВПЦ по колоннам", "S3_Тип_Колонна")
    BT = M["by_type"]
    groups = [(p, k) for p in ("НН", "ГС") for k, *_ in KEYS if BT[p][k]["n_strings"] > 0]
    cd = CategoryChartData()
    cd.categories = [f"{p} · {SHORT[k]}" for p, k in groups]
    cd.add_series("Открытый ствол, медиана", [BT[p][k]["bond_oh"]["median"] for p, k in groups])
    cd.add_series("Весь интервал, медиана", [BT[p][k]["bond_full"]["median"] for p, k in groups])
    gf = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.41), Inches(1.6), Inches(5.9), Inches(4.3), cd)
    ch = gf.chart
    chart_frame(ch, legend=True)
    quiet_axes(ch, "0.0", vmin=0, vmax=1.1, major=0.2)
    ch.category_axis.tick_labels.font.size = Pt(9)
    ch.category_axis.tick_labels.font.color.rgb = NAVY
    bar_series_style(ch, [MET_COL["os"], MET_COL["full"]], gap=60)
    rows = [[H("Профиль · колонна"), H("n"), H("Кобщ ОС\nср. / мед."), H("Кобщ весь\nср. / мед."), H("Мин–макс\n(весь)"), H("Пар\nВПЦ"), H("Недо-\nподъём"), H("Откл.\nмакс, м")]]
    for p in ("НН", "ГС"):
        rows.append([G("Наклонно направленные" if p == "НН" else "Горизонтальные", 8)])
        for k, n, d in KEYS:
            g_ = BT[p][k]
            if g_["n_strings"] == 0:
                rows.append([LB(f"{n}"), dict(t="не цементировался («н/ц») — вне оценки", span=7, fill=ND_FILL, color=GREY, size=8.5)])
                continue
            bg, fg = heat(g_["bond_full"]["median"])
            rows.append([LB(n), V(fi(g_["bond_full"]["n"])), V(f"{f2(g_['bond_oh']['mean'])} / {f2(g_['bond_oh']['median'])}"),
                         V(f"{f2(g_['bond_full']['mean'])} / {f2(g_['bond_full']['median'])}", fill=bg, color=fg, bold=True),
                         V(rng(g_["bond_full"])), V(fi(g_["toc"]["n"])), V(fi(g_["toc"]["under_n"]), color=UNDER if g_["toc"]["under_n"] else NAVY),
                         V(fm(g_["toc"]["max"]), color=UNDER if (g_["toc"]["max"] or 0) > 0 else NAVY)])
    table(s, 6.5, 1.63, [1.42, 0.38, 0.95, 0.95, 0.8, 0.45, 0.55, 0.93], rows, [0.48] + [0.28, 0.4, 0.4, 0.4] * 2)
    heat_legend(s, 6.5, 5.35)
    note(s, 0.41, 6.05, 12.5, 0.55, f"Профиль: ГС — суффикс «ГС» в номере; остальные {cov['wells_nn']} — НН (суффикс «ННС» — у {cov['wells_nn_suffix']}, у прочих — по отсутствию «ГС» и конструкции; "
         "требует подтверждения). n — колонн с Кобщ по всему интервалу. Сравнение НН и ГС описательное: разные конструкции и месторождения.", size=8.5)

    # ---------- 6. Месторождения ----------
    s = content(prs, "Месторождения", "Медиана Кобщ по всему интервалу по месторождениям и колоннам; полнота данных; буровые подрядчики", "S4_Месторождения")
    BF = M["by_field"]
    fields = M["fields"]
    cd = CategoryChartData()
    cd.categories = [f"{f}\n{BF[f]['wells']} скв. (НН {BF[f]['wells_nn']} · ГС {BF[f]['wells_gs']})" for f in fields]
    for k, n, d in KEYS:
        cd.add_series(n, [BF[f][k]["bond_full"]["median"] for f in fields])
    gf = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.41), Inches(1.6), Inches(6.6), Inches(4.4), cd)
    ch = gf.chart
    chart_frame(ch, legend=True)
    quiet_axes(ch, "0.0", vmin=0, vmax=1.1, major=0.2)
    ch.category_axis.tick_labels.font.size = Pt(8.5)
    ch.category_axis.tick_labels.font.color.rgb = NAVY
    bar_series_style(ch, [STR_COL[k] for k, *_ in KEYS], gap=55, lab_size=8.5)
    # n под столбиками — таблица справа
    rows = [[H("Месторождение"), H("Скв."), H("Цем.\nколонн"), H("С Кобщ\nвесь"), H("Пар\nВПЦ"), H("n весь:\nТ / Э / Х")]]
    for f in fields:
        bf = BF[f]
        rows.append([LB(f, size=8.5), V(fi(bf["wells"])), V(fi(bf["strings_cemented"])), V(fi(bf["strings_akc_full"])), V(fi(bf["toc_pairs"])),
                     V(" / ".join(fi(bf[k]["bond_full"]["n"]) for k, *_ in KEYS))])
    text(s, 7.25, 1.63, 5.6, 0.28, "Полнота данных (база 2026)", size=10.5, bold=True, color=NAVY)
    table(s, 7.25, 1.95, [1.75, 0.5, 0.72, 0.72, 0.6, 1.39], rows, [0.46] + [0.36] * len(fields))
    ry = 1.95 + 0.46 + 0.36 * len(fields) + 0.25
    text(s, 7.25, ry, 5.6, 0.28, "Буровой подрядчик: медиана Кобщ весь интервал (n)", size=10.5, bold=True, color=NAVY)
    BC = M["by_contractor"]
    rows = [[H("Подрядчик")] + [H(n) for k, n, d in KEYS] + [H("Скв.")]]
    for c in M["contractors"]:
        cells = [LB(c, bold=True)]
        for k, *_ in KEYS:
            st_ = BC[c][k]["bond_full"]
            bg, fg = heat(st_["median"])
            cells.append(V(f"{f2(st_['median'])} ({st_['n']})", fill=bg, color=fg, bold=True))
        cells.append(V(fi(BC[c]["wells"])))
        rows.append(cells)
    table(s, 7.25, ry + 0.32, [1.1, 1.2, 1.35, 1.2, 0.83], rows, [0.36] + [0.36] * len(M["contractors"]))
    note(s, 7.25, ry + 0.32 + 0.36 * (1 + len(M["contractors"])) + 0.1, 5.65, 0.6,
         "Подрядчик в реестре — буровой; подрядчик по цементированию не указан (н/д). Сравнение подрядчиков — без поправки на месторождение и профиль.", size=8.5)
    small = [f for f in fields if BF[f]["wells"] <= 2]
    if small:
        note(s, 0.41, 6.1, 6.6, 0.5, ", ".join(f"{f} — {BF[f]['wells']} скв." for f in small) + ": медианы по n ≤ 2 приводятся для полноты, не для сравнения.", size=8.5)

    # ---------- 7. Сцепление: месторождение × тип × колонна ----------
    s = content(prs, "Сцепление: месторождение × тип × колонна", "Кобщ 2026: медиана (среднее) и n; открытый ствол и весь интервал — раздельно", "S5_Сцепление_разрез")
    BFT = M["by_field_type"]
    rows = [[H("Месторождение · профиль")] + [H(f"{n} · {d}", span=2) for k, n, d in KEYS],
            [H("")] + [H(t) for _ in KEYS for t in ("Открытый ствол", "Весь интервал")]]
    for f in fields:
        for p in ("НН", "ГС"):
            if all(BFT[f][p][k]["n_strings"] == 0 for k, *_ in KEYS):
                continue
            cells = [LB(f"{f}\n{p}", size=9, bold=True)]
            for k, *_ in KEYS:
                g_ = BFT[f][p][k]
                for m_ in ("bond_oh", "bond_full"):
                    st_ = g_[m_]
                    if g_["n_strings"] == 0:
                        cells.append(dict(t="«н/ц»", fill=ND_FILL, color=GREY, size=9))
                    elif st_["n"] == 0:
                        cells.append(dict(t=f"н/д\n{g_['n_strings']} кол. без АКЦ", fill=ND_FILL, color=GREY, size=9))
                    else:
                        bg, fg = heat(st_["median"])
                        cells.append(dict(t=f"{f2(st_['median'])}\nср. {f2(st_['mean'])} · n = {st_['n']}", fill=bg, color=fg, size=15, size2=8, bold=True))
            rows.append(cells)
    nrows = len(rows) - 2
    table(s, 0.41, 1.63, [2.5] + [1.67] * 6, rows, [0.34, 0.3] + [min(0.85, 3.9 / nrows)] * nrows)
    heat_legend(s, 0.41, 5.75)
    note(s, 5.2, 5.75, 7.7, 0.8, "Хвостовики ГС не цементировались («н/ц») и в оценку не входят. «н/д» — АКЦ не записан или нет информации; значения не восстанавливаются. "
         "Группы с n ≤ 2 — для полноты, не для сравнения.", size=8.5)

    # ---------- 8. ВПЦ ----------
    s = content(prs, "ВПЦ: план, факт, недоподъём", "Отклонение = глубина кровли цемента факт − план, м; > 0 — недоподъём, < 0 — выше плана", "S6_ВПЦ_разрез")
    devs = sorted([p for p in M["points"] if p["dev"] not in (None, 0)], key=lambda p: -p["dev"])
    zero_n = len([p for p in M["points"] if p["dev"] == 0])
    cd = CategoryChartData()
    cd.categories = [f"{p['well']} · {SHORT[p['key']].lower()}" for p in devs]
    cd.add_series("Отклонение, м", [round(p["dev"], 1) for p in devs])
    gf = s.shapes.add_chart(XL_CHART_TYPE.BAR_CLUSTERED, Inches(0.41), Inches(1.9), Inches(5.9), Inches(4.3), cd)
    ch = gf.chart
    chart_frame(ch)
    quiet_axes(ch, "0", vmin=-750, vmax=1750, major=250)
    ch.category_axis.reverse_order = True
    ch.category_axis.tick_label_position = XL_TICK_LABEL_POSITION.LOW
    ch.category_axis.tick_labels.font.size = Pt(8.5)
    ch.category_axis.tick_labels.font.color.rgb = NAVY
    ch.value_axis.tick_label_position = XL_TICK_LABEL_POSITION.HIGH
    pl = ch.plots[0]
    pl.gap_width = 45
    srs = pl.series[0]
    srs.invert_if_negative = False
    for i, p in enumerate(devs):
        pt = srs.points[i]
        pt.format.fill.solid()
        pt.format.fill.fore_color.rgb = UNDER if p["dev"] > 0 else OVER
    pl.has_data_labels = True
    pl.data_labels.number_format = '+#,##0.0;−#,##0.0'
    pl.data_labels.number_format_is_linked = False
    pl.data_labels.position = XL_LABEL_POSITION.OUTSIDE_END
    pl.data_labels.font.size = Pt(8.5)
    pl.data_labels.font.color.rgb = NAVY
    text(s, 0.41, 1.6, 5.9, 0.3, [(f"Ненулевые отклонения: {len(devs)} из {pairs_total} пар ", {"bold": True, "color": NAVY}),
                                   (f"(ещё {zero_n} — точно по плану)", {})], size=10)
    rect(s, 0.5, 6.25, 0.16, 0.14, fill=UNDER); text(s, 0.72, 6.2, 1.6, 0.24, "недоподъём", size=8.5)
    rect(s, 2.1, 6.25, 0.16, 0.14, fill=OVER); text(s, 2.32, 6.2, 2.0, 0.24, "подъём выше плана", size=8.5)
    # таблица разреза
    rows = [[H("Месторождение · профиль · колонна"), H("Пар"), H("План\nмед., м"), H("Факт\nмед., м"), H("Откл.\nмед., м"), H("Откл.\nмакс, м"), H("Недо-\nподъём")]]
    for f in fields:
        rows.append([G(f, 7)])
        for p in ("НН", "ГС"):
            for k, n, d in KEYS:
                g_ = BFT[f][p][k]
                if g_["n_strings"] == 0:
                    continue
                t = g_["toc"]
                rows.append([LB(f"{p} · {n}", size=8), V(fi(t["n"]), size=8), V(fm(t["plan_median"], False), size=8), V(fm(t["fact_median"], False), size=8),
                             V(fm(t["median"]), size=8), V(fm(t["max"]), size=8, color=UNDER if (t["max"] or 0) > 0 else NAVY, bold=(t["max"] or 0) > 0),
                             V(fi(t["under_n"]), size=8, color=UNDER if t["under_n"] else NAVY)])
    nr = len(rows) - 1
    table(s, 6.5, 1.63, [2.2, 0.45, 0.72, 0.72, 0.72, 0.8, 0.82], rows, [0.4] + [0.262] * nr)
    card(s, 6.5, 6.05, 6.43, 0.6, top=BLUE_L)
    text(s, 6.6, 6.15, 6.25, 0.5, f"Пара сопоставляется только при числовых плане и факте. Неполных пар — {len([l_ for l_ in M['log'] if l_[0] == 'Неполная пара ВПЦ'])}. "
         "Отметка «0 м» — числовая глубина из реестра (до устья); текстовой отметки «устье» нет.", size=8.5, color=NAVY)

    # ---------- 9. Наихудшие операции ----------
    s = content(prs, "Наихудшие операции", "Минимальный Кобщ и наибольший недоподъём цемента; осложнения в реестре не указаны", "S7_Худшие")
    hdr_ = [H("Скважина"), H("Куст"), H("Месторождение"), H("Колонна"), H("Кобщ\nОС"), H("Кобщ\nвесь"), H("Откл.\nВПЦ, м"), H("Буровой\nподр.")]
    cw = [0.9, 0.42, 1.4, 1.0, 0.5, 0.55, 0.65, 0.73]

    def worst_rows(lst, hl):
        rows = [hdr_]
        for i, w in enumerate(lst):
            fill = CARD if i % 2 else WHITE
            bg, fg = heat(w.get("full"))
            dev = w.get("dev")
            rows.append([LB(w["well"], fill=fill, bold=True), V(w["pad"] or ND, fill=fill), LB(w["field"], fill=fill, size=8.5),
                         V(f"{SHORT[[k for k, n, _ in KEYS if n == w['string']][0]]} {w['diam']}", fill=fill, size=8.5),
                         V(f2(w.get("os")), fill=fill), V(f2(w.get("full")), fill=bg if hl == "full" else fill, color=fg if hl == "full" else NAVY, bold=hl == "full"),
                         V(fm(dev), fill=fill, color=UNDER if (dev or 0) > 0 else NAVY, bold=hl == "toc"), V(w["contractor"] or ND, fill=fill)])
        return rows
    text(s, 0.41, 1.6, 6.3, 0.28, "Минимальный Кобщ по всему интервалу", size=10.5, bold=True, color=NAVY)
    wb_ = M["worst_bond"][:6]
    table(s, 0.41, 1.9, cw, worst_rows(wb_, "full"), [0.42] + [0.33] * len(wb_))
    text(s, 6.95, 1.6, 6.0, 0.28, "Наибольший недоподъём ВПЦ", size=10.5, bold=True, color=NAVY)
    wt_ = M["worst_toc"][:6]
    table(s, 6.95, 1.9, [0.9, 0.38, 1.47, 0.9, 0.42, 0.5, 0.75, 0.66], worst_rows(wt_, "toc"), [0.42] + [0.33] * len(wt_))
    # чувствительность
    by = 1.9 + 0.42 + 0.33 * 6 + 0.25
    card(s, 0.41, by, 12.52, 1.55, top=LIME)
    SE = M["sensitivity"]
    text(s, 0.58, by + 0.15, 4.3, 0.3, "Расчёт чувствительности", size=11, bold=True, color=NAVY)
    text(s, 0.58, by + 0.48, 4.3, 1.4, [("Технически невалидных замеров: 0. ", {"bold": True, "color": NAVY}),
                                         ("Графа «Примечание» пуста — оснований для исключения нет; низкие значения (например, 0,15) остаются в выборке. "
                                          "Поглощения и осложнения в реестре не указаны.", {})], size=9)
    rows = [[H("Кобщ весь интервал"), H("База 2026:\nn · медиана · среднее"), H(f"+ {cov['wells_nodate']} записи без даты:\nn · медиана · среднее")]]
    for k, n, d in KEYS:
        a, b = SE["base"][k]["full"], SE["with_nodate"][k]["full"]
        rows.append([LB(n, fill=CARD), V(f"{a['n']} · {f2(a['median'])} · {f2(a['mean'])}", fill=CARD), V(f"{b['n']} · {f2(b['median'])} · {f2(b['mean'])}", fill=CARD)])
    table(s, 5.1, by + 0.15, [1.9, 2.8, 3.0], rows, [0.44, 0.3, 0.3, 0.3])

    # ---------- 10. Полнота данных ----------
    s = content(prs, "Полнота данных и ограничения", "Статус каждой исходной ячейки АКЦ и ВПЦ по скважинам реестра · SRTi и осложнения в реестре отсутствуют", "S8_Полнота")
    # порядок скважин как в реестре
    import openpyxl  # noqa: локально — только для чтения порядка/сырых статусов из книги расчётов
    wbk = openpyxl.load_workbook(os.path.join(ROOT, "output", "Расчёт_цементирование_2026.xlsx"), data_only=True)
    ws = wbk["S8_Полнота"]
    data = []
    r = 3
    while ws.cell(row=r, column=1).value and not str(ws.cell(row=r, column=1).value).startswith("Нет"):
        data.append([ws.cell(row=r, column=c).value for c in range(1, 14)])
        r += 1
    def FSf(name):  # «Западно-Имя» → «З-Имя.» (сокращение для узкой колонки)
        parts = name.split("-")
        return (parts[0][0] + "-" + parts[-1][:5] + ".") if len(parts) > 1 else name[:6] + "."
    rows = [[H("Скважина", size=7.5), H("Мест.", size=7.5), H("Проф.", size=7.5), H("Год", size=7.5)] +
            [H(f"{SHORT[k]}: {x}", size=7) for k, *_ in KEYS for x in ("ОС", "весь", "ВПЦ")]]
    for d in data:
        base = d[3] == 1
        cells = [LB(str(d[0]), size=7.5, bold=True, fill=WHITE if base else ND_FILL), V(FSf(d[1]), size=7, fill=WHITE if base else ND_FILL),
                 V(d[2], size=7.5, fill=WHITE if base else ND_FILL), V("2026" if base else ND, size=7.5, color=NAVY if base else UNDER, fill=WHITE if base else ND_FILL)]
        for v in d[4:13]:
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                cells.append(V(f3(v), size=7.5, fill=LIME_L))
            elif v == "да":
                cells.append(V("пара", size=7.5, fill=LIME_L))
            elif v in ("н/ц",):
                cells.append(V("н/ц", size=7.5, fill=CARD, color=GREY))
            elif v == "нет":
                cells.append(V("нет", size=7.5, fill=RGB("F6D5D1"), color=UNDER))
            else:
                cells.append(V(ND, size=7.5, fill=RGB("F6D5D1"), color=UNDER))
        rows.append(cells)
    rh = min(0.195, 4.95 / len(rows))
    table(s, 0.41, 1.6, [0.82, 0.68, 0.42, 0.42] + [0.6] * 9, rows, [0.3] + [rh] * (len(rows) - 1))
    lx = 0.41 + 0.82 + 0.68 + 0.84 + 5.4 + 0.2
    for i, (c, t) in enumerate(((LIME_L, "значение есть / пара ВПЦ"), (RGB("F6D5D1"), "н/д: «Не писали», «нет инф», пусто"), (CARD, "н/ц — не цементировалась"), (ND_FILL, "строка вне базы (нет даты)"))):
        rect(s, lx, 1.65 + i * 0.27, 0.2, 0.16, fill=c, line=LINE_L, lw=0.5)
        text(s, lx + 0.28, 1.6 + i * 0.27, 3.3, 0.25, t, size=8.5)
    card(s, lx, 2.85, 12.93 - lx, 1.72, top=UNDER)
    text(s, lx + 0.12, 2.98, 12.93 - lx - 0.24, 1.6,
         [("Нет в реестре (н/д для всех записей):\n", {"bold": True, "color": NAVY})] +
         [("• " + t + "\n", {}) for t in M["missing_fields"]], size=8.5)
    card(s, lx, 4.7, 12.93 - lx, 1.9, top=BLUE_L)
    sim = [l_ for l_ in M["log"] if l_[0] == "Похожие номера"]
    text(s, lx + 0.12, 4.83, 12.93 - lx - 0.24, 1.75,
         [("Проверки реестра:\n", {"bold": True, "color": NAVY}),
          (("• " + " и ".join(sorted({l_[1] for l_ in sim})) + " — похожие номера, разные записи (куст, даты): не объединены, нужна сверка.\n") if sim else "", {}),
          (f"• {cov['wells_nodate']} записи без дат бурения: " + ", ".join(M["sensitivity"]["nodate_wells"]) + ".\n", {}),
          ("• Профиль НН у скважин без суффикса принят по конструкции — подтвердить.\n", {}),
          ("• Доля неизвестного статуса SRTi — 100 %: сравнение SRTi невозможно.", {})], size=8.5)

    # ---------- 11. Приложение: методика ----------
    s = content(prs, "Приложение: методика", "Единые правила расчёта; каждое число проверяется в книге «Расчёт_цементирование_2026.xlsx»", "README")
    items = [
        ("01", "База и единицы учёта", f"Скважины, законченные бурением в 2026 г. ({cov['wells']}). Единица оценки — колонна (операция цементирования). "
                                       "Даты АКЦ в реестре нет; год определяется окончанием бурения."),
        ("02", "Кобщ", "Открытый ствол и весь интервал — раздельно. Для группы: среднее, медиана, n, мин–макс по всей валидной выборке."),
        ("03", "Валидность", "Исключение — только при подтверждённой технической невалидности. В реестре оснований нет → исключений нет; "
                             "чувствительность — к записям без даты."),
        ("04", "ВПЦ", "Только числовые пары план/факт. Отклонение = факт − план; > 0 — недоподъём. «0 м» — числовая отметка из реестра."),
        ("05", "Колонны и профиль", "Техническая 245, эксплуатационная 168/178, хвостовик 114 мм — по графам реестра. «н/ц» — вне оценки. "
                                   "ГС — по суффиксу номера."),
        ("06", "Пороги, 2025, SRTi", "0,80 и 0,90 — справочно, критерий не утверждён. Данных 2025 г. и SRTi нет — статистика не рассчитывается."),
    ]
    for i, (num, head, body) in enumerate(items):
        bx, by = 0.41 + (i % 2) * 6.36, 1.63 + (i // 2) * 1.62
        rect(s, bx, by, 6.16, 1.45, fill=LIME_XL)
        rect(s, bx, by, 0.95, 1.45, fill=LIME_L)
        text(s, bx, by, 0.95, 1.45, num, size=26, color=GREEN_D, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        text(s, bx + 1.1, by + 0.12, 4.9, 0.3, head, size=12, color=NAVY)
        text(s, bx + 1.1, by + 0.45, 4.9, 0.95, body, size=9.5, color=GREY)

    # заключительный слайд формы — в конец
    for shp in prs.slides[0].shapes:
        if shp.is_placeholder and shp.placeholder_format.idx == 0:
            shp.width = Inches(4.5)
    lst = prs.slides._sldIdLst
    first = list(lst)[0]
    lst.remove(first)
    lst.append(first)
    prs.save(out)
    return out


if __name__ == "__main__":
    print(build(os.path.join(ROOT, "output", "Качество_цементирования_РВП_2026.pptx")))
