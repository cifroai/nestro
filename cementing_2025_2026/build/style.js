// Общая дизайн-система «Деловой стандарт» для презентации по цементированию.
const React = require("react");
const RDS = require("react-dom/server");
const sharp = require("sharp");
const path = require("path");

const C = {
  green: "3F8A3A",      // заголовок, строка 1; ключевые слова
  greenBtn: "4F9D46",   // кнопки, плашка-вкладка, 2026
  lime: "9BC53D",
  blue: "2F5FA6",       // заголовок, строка 2; жирные ключевые слова
  navy: "1D3F7A",
  amber: "E0A93B",
  red: "C9453F",        // недоподъём / худшие операции
  text: "34373D",
  muted: "6B7280",
  line: "C9D3DE",
  card: "F4F7FA",
  inner: "FFFFFF",
  nd: "E4E8ED",         // ячейки «н/д»
  y2025: "8FA6C4",      // опубликованные агрегаты 2025
};
const F = { head: "Montserrat ExtraBold", body: "Montserrat", medium: "Montserrat Medium" };
const ASSETS = path.join(__dirname, "assets");

async function icon(Comp, color = "#FFFFFF", size = 256) {
  const svg = RDS.renderToStaticMarkup(React.createElement(Comp, { color, size }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

function background(slide) {
  slide.background = { path: path.join(ASSETS, "bg.jpg") };
}

// Большая «стеклянная» карточка с двойным краем
function card(slide, pres) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.52, y: 1.07, w: 12.4, h: 6.18, rectRadius: 0.45,
    fill: { color: "FFFFFF", transparency: 55 }, line: { color: "FFFFFF", transparency: 100 } });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.45, y: 0.95, w: 12.4, h: 6.18, rectRadius: 0.45,
    fill: { color: C.card, transparency: 6 }, line: { color: "FFFFFF", width: 1.5 },
    shadow: { type: "outer", color: "1D3F7A", opacity: 0.12, blur: 18, offset: 4, angle: 90 } });
}

// Индикатор «точка — короткое тире — длинное тире» (верх справа)
function progress(slide, pres, x = 10.85, y = 1.29) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: 0.11, h: 0.11, fill: { color: C.amber }, line: { color: C.amber, width: 0 } });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 0.19, y, w: 0.38, h: 0.11, rectRadius: 0.055, fill: { color: C.greenBtn }, line: { color: C.greenBtn, width: 0 } });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 0.65, y, w: 0.85, h: 0.11, rectRadius: 0.055, fill: { color: C.blue }, line: { color: C.blue, width: 0 } });
}

// Шапка: зелёная вкладка с иконкой + надзаголовок + двухцветный заголовок
function header(slide, pres, { kicker, l1, l2, iconData }) {
  slide.addShape(pres.shapes.ROUND_2_SAME_RECTANGLE, { x: 0.95, y: 0.95, w: 0.66, h: 1.42, rotate: 180,
    rectRadius: 0.33, fill: { color: C.greenBtn }, line: { color: C.greenBtn, width: 0 } });
  if (iconData) slide.addImage({ data: iconData, x: 1.08, y: 1.78, w: 0.4, h: 0.4 });
  slide.addText(kicker, { x: 1.85, y: 1.08, w: 9.2, h: 0.3, margin: 0, isTextBox: true,
    fontFace: F.medium, fontSize: 11, color: C.muted, charSpacing: 1 });
  slide.addText([
    { text: l1, options: { color: C.green, breakLine: !!l2 } },
    ...(l2 ? [{ text: l2, options: { color: C.blue } }] : []),
  ], { x: 1.85, y: 1.38, w: 9.3, h: 0.95, margin: 0, isTextBox: true, fontFace: F.head, fontSize: 24,
    lineSpacingMultiple: 0.95, valign: "top" });
}

// Внутренняя карточка контента
function inner(slide, pres, box = { x: 0.85, y: 2.55, w: 11.6, h: 3.95 }) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { ...box, rectRadius: 0.3,
    fill: { color: C.inner, transparency: 20 }, line: { color: "FFFFFF", width: 1 } });
  return box;
}

// Нижняя «пилюля»: ссылка на лист расчётов + номер слайда в круге
function sourcePill(slide, pres, text, num) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 8.55, y: 6.6, w: 3.9, h: 0.4, rectRadius: 0.2,
    fill: { color: "FFFFFF", transparency: 15 }, line: { color: "FFFFFF", width: 1 } });
  slide.addText(text, { x: 8.75, y: 6.6, w: 3.15, h: 0.4, margin: 0, isTextBox: true,
    fontFace: F.body, fontSize: 9.5, color: C.muted, valign: "middle" });
  slide.addShape(pres.shapes.OVAL, { x: 12.0, y: 6.64, w: 0.32, h: 0.32, fill: { color: "FFFFFF" }, line: { color: C.blue, width: 1 } });
  slide.addText(String(num), { x: 12.0, y: 6.64, w: 0.32, h: 0.32, margin: 0, isTextBox: true,
    fontFace: F.body, fontSize: 9, color: C.blue, align: "center", valign: "middle" });
}

// Светлая полоса вверху карточки (титульный слайд) — на ней индикатор
function topStrip(slide, pres) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.85, y: 1.13, w: 11.6, h: 0.42, rectRadius: 0.21,
    fill: { color: "FFFFFF", transparency: 45 }, line: { color: "FFFFFF", width: 0.75 } });
}

// Плитка с иконкой и зелёной точкой в левом верхнем углу (как 3D-плитки шаблона)
function tile(slide, pres, { x, y, w = 1.45, h = 1.6, iconData }) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.28,
    fill: { color: "FFFFFF", transparency: 10 }, line: { color: "FFFFFF", width: 1 },
    shadow: { type: "outer", color: "1D3F7A", opacity: 0.10, blur: 10, offset: 3, angle: 90 } });
  slide.addShape(pres.shapes.OVAL, { x: x + 0.16, y: y + 0.16, w: 0.1, h: 0.1, fill: { color: C.greenBtn }, line: { color: C.greenBtn, width: 0 } });
  const s = Math.min(w, h) * 0.55;
  slide.addImage({ data: iconData, x: x + (w - s) / 2, y: y + (h - s) / 2 + 0.05, w: s, h: s });
}

// Переход «Сдвиг» (push) на всех слайдах: фон с полосами остаётся, контент сдвигается.
// pptxgenjs не пишет переходы, поэтому дописываем <p:transition> в XML слайдов.
async function addPushTransitions(file) {
  const JSZip = require("jszip");
  const fs = require("fs");
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  for (const name of Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    let xml = await zip.file(name).async("string");
    if (!xml.includes("<p:transition")) {
      xml = xml.replace(/(<\/p:clrMapOvr>)/, '$1<p:transition spd="med"><p:push dir="l"/></p:transition>');
      zip.file(name, xml);
    }
  }
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

module.exports = { C, F, ASSETS, icon, background, card, progress, header, inner, sourcePill, topStrip, tile, addPushTransitions };
