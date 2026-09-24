# Фон в стиле «Деловой стандарт»: наклонные полосы синий→зелёный→лайм по верхнему и левому краю,
# плавно уходящие в светлое холодное поле.
import numpy as np
from PIL import Image, ImageFilter
import sys, os
out = sys.argv[1]
W, H = 2400, 1350
y, x = np.mgrid[0:H, 0:W].astype(np.float32)

def hexrgb(h): return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], np.float32)
stops = [hexrgb(c) for c in ["1D3F7A", "2A5AA0", "2F74B0", "3E8F7A", "4F9D46", "7DB548", "A9CC5C", "D2E6A6"]]

def ramp(t):
    t = np.clip(t, 0, 1) * (len(stops) - 1)
    i = np.clip(np.floor(t).astype(int), 0, len(stops) - 2)
    f = (t - i)[..., None]
    a = np.stack(stops)[i]; b = np.stack(stops)[i + 1]
    return a * (1 - f) + b * f

# база: светлый холодный градиент
base = (hexrgb("E3EAF1") * (1 - x / W)[..., None] * (1 - y / H)[..., None] * 0 +
        hexrgb("E6ECF2")[None, None, :] * (1 - (x / W)[..., None] * 0.5) +
        hexrgb("EDF3EA")[None, None, :] * ((x / W)[..., None] * 0.5))

# полосы: ступенчатый индекс вдоль наклонной оси
stripe_w = 190.0
u = (x + 0.30 * (H - y)) / stripe_w
idx = np.floor(u)
col = ramp(idx / 9.0)
# лёгкое чередование яркости и наложение «стекла»
col = col * (1 + 0.035 * ((idx % 2) * 2 - 1))[..., None]

# маска: верхняя полоса + левый край + нижний левый угол, с мягким затуханием вправо
top = np.clip((0.215 * H - y) / 40, 0, 1) * np.clip((0.62 * W - x) / 420, 0, 1)
left = np.clip((0.085 * W - x) / 50, 0, 1)
botl = np.clip((y - 0.86 * H) / 40, 0, 1) * np.clip((0.36 * W - x) / 380, 0, 1)
mask = np.clip(np.maximum(np.maximum(top, left), botl), 0, 1)
mask = np.array(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), np.float32) / 255
img = base * (1 - mask[..., None]) + col * mask[..., None]
# полупрозрачная светлая панель внизу по центру (заходит под карточку)
panel = ((x > 0.37 * W) & (x < 0.63 * W) & (y > 0.865 * H)).astype(np.float32)
img = img * (1 - 0.35 * panel[..., None]) + 255 * 0.35 * panel[..., None]
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(out, quality=92)

# градиентная линия (низ титульного слайда): синий → зелёный → лайм
# ступенчатая линия: 5 сегментов, как в шаблоне
seg = [hexrgb(c) for c in ["2A4F97", "2F6FB0", "3E8F4E", "4F9D46", "8DBF45"]]
g = np.concatenate([np.tile(c, (320, 1)) for c in seg])[None, :, :].repeat(12, 0)
Image.fromarray(np.clip(g, 0, 255).astype(np.uint8)).save(os.path.join(os.path.dirname(out), "gradline.png"))
# вертикальная шкала для списков: янтарь → зелёный → синий
v = np.concatenate([np.linspace(hexrgb("E0A93B"), hexrgb("4F9D46"), 300), np.linspace(hexrgb("4F9D46"), hexrgb("2F5FA6"), 300)])
Image.fromarray(np.clip(v[:, None, :].repeat(40, 1), 0, 255).astype(np.uint8)).save(os.path.join(os.path.dirname(out), "vgrad.png"))
