const pptxgen = require("pptxgenjs");
const path = require("path");
const { FaOilWell, FaChartColumn, FaTableCells, FaPalette } = require("react-icons/fa6");
const S = require("./style");
const { C, F } = S;

(async () => {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.title = "Качество цементирования — образец оформления";
  pres.author = "СП «РУСВЬЕТПЕТРО»";
  const icWell = await S.icon(FaOilWell), icChart = await S.icon(FaChartColumn),
        icTable = await S.icon(FaTableCells), icPal = await S.icon(FaPalette);

  // ---------- 1. Титульный ----------
  {
    const s = pres.addSlide(); S.background(s);
    s.addText("СП «РУСВЬЕТПЕТРО»", { x: 1.3, y: 0.3, w: 5, h: 0.45, margin: 0, isTextBox: true, fontFace: F.head, fontSize: 16, color: "FFFFFF" });
    S.card(s, pres); S.progress(s, pres);
    // Схема конструкции скважины: цементное кольцо (лайм) между стенкой ствола и колонной
    const cx = 2.55, g = 1.85;
    const strings = [
      { hole: 0.95, cas: 0.8, shoe: 2.85, toc: g, name: "Кондуктор" },
      { hole: 0.66, cas: 0.53, shoe: 4.35, toc: g, name: "Техническая колонна" },
      { hole: 0.44, cas: 0.32, shoe: 6.15, toc: 3.75, name: "Эксплуатационная колонна" },
    ];
    s.addShape(pres.shapes.LINE, { x: 1.2, y: g, w: 3.0, h: 0, line: { color: C.muted, width: 1 } });
    strings.forEach((t, i) => {
      s.addShape(pres.shapes.RECTANGLE, { x: cx - t.hole, y: t.toc, w: t.hole * 2, h: t.shoe - t.toc,
        fill: { color: i === 2 ? C.lime : "B9D98A" }, line: { color: C.card, width: 0 } });
      s.addShape(pres.shapes.RECTANGLE, { x: cx - t.cas, y: g, w: t.cas * 2, h: t.shoe - g,
        fill: { color: C.card }, line: { color: C.navy, width: 1.75 } });
    });
    // ВПЦ план / факт на эксплуатационной колонне
    s.addShape(pres.shapes.LINE, { x: cx - 0.6, y: 3.45, w: 1.2, h: 0, line: { color: C.blue, width: 1.25, dashType: "dash" } });
    s.addShape(pres.shapes.LINE, { x: cx - 0.6, y: 3.75, w: 1.2, h: 0, line: { color: C.red, width: 1.5 } });
    const lab = (txt, y, color = C.text) => s.addText(txt, { x: 3.62, y: y - 0.14, w: 1.8, h: 0.28, margin: 0, isTextBox: true, fontFace: F.medium, fontSize: 9, color });
    lab("Кондуктор", 2.6); lab("Техническая", 4.3); lab("Эксплуатационная", 5.9);
    lab("ВПЦ план", 3.38, C.blue); lab("ВПЦ факт", 3.82, C.red);

    s.addText("ИНЖЕНЕРНЫЙ АНАЛИЗ · АКЦ · ВПЦ · SRTi", { x: 5.6, y: 2.15, w: 6.8, h: 0.3, margin: 0, isTextBox: true, fontFace: F.medium, fontSize: 12, color: C.muted, charSpacing: 1.5 });
    s.addText([
      { text: "КАЧЕСТВО", options: { breakLine: true } },
      { text: "ЦЕМЕНТИРОВАНИЯ" },
    ], { x: 5.6, y: 2.55, w: 6.9, h: 1.55, margin: 0, isTextBox: true, fontFace: F.head, fontSize: 40, color: C.green, lineSpacingMultiple: 0.9 });
    s.addText("обсадных колонн: 2025 → 2026", { x: 5.6, y: 4.1, w: 6.9, h: 0.6, margin: 0, isTextBox: true, fontFace: F.head, fontSize: 26, color: C.blue });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 5.6, y: 5.05, w: 3.3, h: 0.62, rectRadius: 0.31, fill: { color: C.greenBtn }, line: { color: C.greenBtn, width: 0 },
      shadow: { type: "outer", color: "3F8A3A", opacity: 0.25, blur: 8, offset: 2, angle: 90 } });
    s.addText("Образец оформления", { x: 5.6, y: 5.05, w: 3.3, h: 0.62, margin: 0, isTextBox: true, fontFace: F.medium, fontSize: 14, color: "FFFFFF", align: "center", valign: "middle" });
    s.addImage({ path: path.join(S.ASSETS, "gradline.png"), x: 1.0, y: 6.62, w: 11.3, h: 0.05 });
  }

  // ---------- 2. Образец: KPI + диаграмма ----------
  {
    const s = pres.addSlide(); S.background(s); S.card(s, pres); S.progress(s, pres);
    S.header(s, pres, { kicker: "ОБРАЗЕЦ ОФОРМЛЕНИЯ · ДАННЫЕ УСЛОВНЫЕ", l1: "Общая динамика", l2: "коэффициент сцепления 2025 → 2026", iconData: icChart });
    S.inner(s, pres);
    const tiles = [
      { lab: "Открытый ствол", v26: "0,78", v25: "0,74", n: "n = 42 колонны", d: "+0,04" },
      { lab: "Весь интервал", v26: "0,83", v25: "0,81", n: "n = 42 колонны", d: "+0,02" },
      { lab: "ВПЦ: недоподъём, медиана", v26: "35 м", v25: "н/д", n: "n = 18 пар план/факт", d: "" },
    ];
    tiles.forEach((t, i) => {
      const y = 2.78 + i * 1.22;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1.1, y, w: 4.1, h: 1.07, rectRadius: 0.18, fill: { color: "FFFFFF" }, line: { color: C.line, width: 0.75 } });
      s.addText(t.lab, { x: 1.3, y: y + 0.1, w: 3.0, h: 0.26, margin: 0, isTextBox: true, fontFace: F.medium, fontSize: 10.5, color: C.muted });
      s.addText(t.v26, { x: 1.3, y: y + 0.36, w: 1.6, h: 0.6, margin: 0, isTextBox: true, fontFace: F.head, fontSize: 28, color: C.green, valign: "middle" });
      s.addText([
        { text: "2025: ", options: { color: C.muted } }, { text: t.v25, options: { color: C.text, bold: true, breakLine: true } },
        { text: t.n, options: { color: C.muted } },
      ], { x: 2.95, y: y + 0.4, w: 1.9, h: 0.55, margin: 0, isTextBox: true, fontFace: F.body, fontSize: 9.5, valign: "middle" });
      if (t.d) {
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 4.4, y: y + 0.1, w: 0.68, h: 0.26, rectRadius: 0.13, fill: { color: "E3F1DC" }, line: { color: "E3F1DC", width: 0 } });
        s.addText(t.d, { x: 4.4, y: y + 0.1, w: 0.68, h: 0.26, margin: 0, isTextBox: true, fontFace: F.medium, fontSize: 9.5, color: C.green, align: "center", valign: "middle" });
      }
    });
    s.addChart(pres.charts.BAR, [
      { name: "2025 — опубликованный агрегат (среднее)", labels: ["Открытый ствол", "Весь интервал"], values: [0.74, 0.81] },
      { name: "2026 — среднее по построчным данным", labels: ["Открытый ствол", "Весь интервал"], values: [0.78, 0.83] },
    ], { x: 5.5, y: 2.75, w: 6.75, h: 3.6, barDir: "col", barGapWidthPct: 60,
      chartColors: [C.y2025, C.greenBtn], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.00",
      dataLabelFontFace: F.body, dataLabelFontSize: 11, dataLabelColor: C.text,
      valAxisMinVal: 0, valAxisMaxVal: 1, valAxisLabelFormatCode: "0.0", valAxisLabelColor: C.muted, valAxisLabelFontSize: 9,
      catAxisLabelColor: C.text, catAxisLabelFontFace: F.medium, catAxisLabelFontSize: 11, catAxisLineShow: false,
      valGridLine: { color: "E3E8EE", size: 0.75 }, catGridLine: { style: "none" },
      showLegend: true, legendPos: "b", legendFontFace: F.body, legendFontSize: 9.5, legendColor: C.muted,
      showTitle: true, title: "Средний коэффициент сцепления", titleFontFace: F.medium, titleFontSize: 12, titleColor: C.text });
    S.sourcePill(s, pres, "Расчёт: лист «S2_Динамика», строки 4–9", 2);
  }

  // ---------- 3. Образец: тепловая карта с «н/д» ----------
  {
    const s = pres.addSlide(); S.background(s); S.card(s, pres); S.progress(s, pres);
    S.header(s, pres, { kicker: "ОБРАЗЕЦ ОФОРМЛЕНИЯ · ДАННЫЕ УСЛОВНЫЕ", l1: "Месторождение × колонна", l2: "тепловая карта сцепления, весь интервал", iconData: icTable });
    S.inner(s, pres);
    const heat = v => v == null ? C.nd : v >= 0.9 ? "3F8A3A" : v >= 0.85 ? "6FAE55" : v >= 0.8 ? "A9CC5C" : v >= 0.7 ? "F0D48A" : "E8A39E";
    const fg = v => v != null && v >= 0.85 ? "FFFFFF" : C.text;
    const cols = ["Техническая", "Эксплуатационная", "Хвостовик цем.", "Полнота АКЦ"];
    const rows = [
      ["Месторождение A", [0.91, 18], [0.84, 17], [null, 0], "35 / 36"],
      ["Месторождение B", [0.86, 9], [0.76, 9], [0.69, 4], "22 / 25"],
      ["Месторождение C", [0.82, 6], [null, 0], [0.88, 3], "9 / 14"],
    ];
    const hdr = ["", ...cols].map((t, i) => ({ text: t, options: { bold: false, fontFace: F.medium, fontSize: 10.5, color: C.muted, align: i ? "center" : "left", fill: { color: "FFFFFF" }, border: [{ type: "none" }, { type: "none" }, { pt: 1, color: C.line }, { type: "none" }] } }));
    const body = rows.map(r => [
      { text: r[0], options: { fontFace: F.medium, fontSize: 12, color: C.text, fill: { color: "FFFFFF" } } },
      ...r.slice(1, 4).map(([v, n]) => ({ text: v == null ? [{ text: "н/д", options: { fontSize: 13 } }] :
        [{ text: v.toFixed(2).replace(".", ","), options: { fontFace: F.head, fontSize: 16, breakLine: true } }, { text: `n = ${n}`, options: { fontSize: 9 } }],
        options: { align: "center", valign: "middle", fill: { color: heat(v) }, color: v == null ? C.muted : fg(v), fontFace: F.body, border: { pt: 3, color: "FFFFFF" } } })),
      { text: r[4], options: { align: "center", fontFace: F.medium, fontSize: 12, color: C.blue, fill: { color: "FFFFFF" } } },
    ]);
    s.addTable([hdr, ...body], { x: 1.15, y: 2.8, w: 8.1, colW: [2.0, 1.5, 1.9, 1.5, 1.2], rowH: [0.42, 0.82, 0.82, 0.82], valign: "middle", margin: [0.04, 0.1, 0.04, 0.1] });
    // легенда шкалы
    const leg = [["≥ 0,90", "3F8A3A"], ["0,85–0,90", "6FAE55"], ["0,80–0,85", "A9CC5C"], ["0,70–0,80", "F0D48A"], ["< 0,70", "E8A39E"], ["н/д", C.nd]];
    s.addText("Шкала (цветовая, не критерий «хорошо/плохо»)", { x: 9.65, y: 2.8, w: 2.6, h: 0.5, margin: 0, isTextBox: true, fontFace: F.medium, fontSize: 10, color: C.muted });
    leg.forEach(([t, col], i) => {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 9.65, y: 3.4 + i * 0.4, w: 0.42, h: 0.26, rectRadius: 0.06, fill: { color: col }, line: { color: col, width: 0 } });
      s.addText(t, { x: 10.2, y: 3.4 + i * 0.4, w: 1.9, h: 0.26, margin: 0, isTextBox: true, fontFace: F.body, fontSize: 10, color: C.text, valign: "middle" });
    });
    s.addText("«н/д» — нет валидного замера в реестре; значения не восстанавливаются.", { x: 1.15, y: 5.85, w: 8.1, h: 0.35, margin: 0, isTextBox: true, fontFace: F.body, fontSize: 10, color: C.muted, italic: true });
    S.sourcePill(s, pres, "Расчёт: лист «S5_Мест_Колонна»", 3);
  }

  // ---------- 4. Паспорт стиля ----------
  {
    const s = pres.addSlide(); S.background(s); S.card(s, pres); S.progress(s, pres);
    S.header(s, pres, { kicker: "СЛУЖЕБНЫЙ СЛАЙД · НА СОГЛАСОВАНИЕ", l1: "Паспорт стиля", l2: "цвета, шрифты, правила диаграмм", iconData: icPal });
    S.inner(s, pres);
    const sw = [
      [C.green, "Зелёный", "заголовок, стр. 1"], [C.greenBtn, "Зелёный акцент", "кнопки, 2026"], [C.blue, "Синий", "заголовок, стр. 2"],
      [C.navy, "Тёмно-синий", "контуры, схемы"], [C.lime, "Лайм", "цемент, фон"], [C.amber, "Янтарь", "индикатор, внимание"],
      [C.red, "Красный", "недоподъём, худшие"], [C.y2025, "Серо-синий", "агрегаты 2025"],
    ];
    sw.forEach(([col, n, r], i) => {
      const x = 1.15 + (i % 2) * 2.55, y = 2.8 + Math.floor(i / 2) * 0.88;
      s.addShape(pres.shapes.OVAL, { x, y, w: 0.52, h: 0.52, fill: { color: col }, line: { color: "FFFFFF", width: 1.5 } });
      s.addText([{ text: n, options: { fontFace: F.medium, fontSize: 10.5, color: C.text, breakLine: true } },
        { text: `#${col} · ${r}`, options: { fontSize: 8.5, color: C.muted } }], { x: x + 0.62, y: y - 0.04, w: 1.85, h: 0.6, margin: 0, isTextBox: true, fontFace: F.body, valign: "middle" });
    });
    // правила — мотив «вертикальная шкала + выноски» из корпоративного шаблона
    s.addImage({ path: path.join(S.ASSETS, "vgrad.png"), x: 6.55, y: 2.85, w: 0.2, h: 3.35, rounding: false });
    const rules = [
      ["Заголовок", " — Montserrat ExtraBold 24–40 пт: 1-я строка зелёная, 2-я синяя"],
      ["Текст", " — Montserrat 10–14 пт, ключевые слова жирным зелёным/синим"],
      ["2025", " — только опубликованные агрегаты, серо-синий, без медианы"],
      ["Пороги 0,80 / 0,90", " — показываются оба, пока критерий не подтверждён"],
      ["Каждый слайд", " — «пилюля» со ссылкой на лист и строки расчёта"],
    ];
    rules.forEach(([b, t], i) => {
      const y = 2.95 + i * 0.66;
      s.addShape(pres.shapes.LINE, { x: 6.9, y: y + 0.17, w: 0.45, h: 0, line: { color: C.blue, width: 1 } });
      s.addText([{ text: b, options: { fontFace: F.head, color: C.blue } }, { text: t, options: { color: C.text } }],
        { x: 7.5, y, w: 4.75, h: 0.5, margin: 0, isTextBox: true, fontFace: F.body, fontSize: 11, valign: "top" });
    });
    S.sourcePill(s, pres, "Цвета сняты с фото экрана и нормализованы", 4);
  }

  await pres.writeFile({ fileName: path.join(__dirname, "..", "output", "style_sample.pptx") });
  console.log("written");
})();
