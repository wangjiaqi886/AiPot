from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np
import os

OUT_DIR = r"D:\AiPot-master\public"
os.makedirs(OUT_DIR, exist_ok=True)

S = 4096  # supersampled canvas
R = 880  # corner radius at 4096 scale (~22%)

# --- gradient background ---
y, x = np.mgrid[0:S, 0:S].astype(np.float32) / (S - 1)
# diagonal gradient from indigo (top-left) to violet (bottom-right)
t = np.clip((x * 0.55 + y * 0.45), 0, 1)
c0 = np.array([36, 43, 128], dtype=np.float32)    # #242B80
c1 = np.array([124, 58, 237], dtype=np.float32)   # #7C3AED
rgb = c0[None, None, :] * (1 - t[..., None]) + c1[None, None, :] * t[..., None]

# radial highlight top-left
cx, cy = 0.28 * S, 0.22 * S
dist = np.sqrt((x * S - cx) ** 2 + (y * S - cy) ** 2) / (0.75 * S)
glow = np.clip(1 - dist, 0, 1) ** 2 * 0.35
rgb = rgb + (np.array([99, 102, 241], dtype=np.float32) - rgb) * glow[..., None]
rgb = np.clip(rgb, 0, 255).astype(np.uint8)
img = Image.fromarray(rgb, 'RGB').convert('RGBA')

# rounded-square mask
mask = Image.new('L', (S, S), 0)
mdraw = ImageDraw.Draw(mask)
mdraw.rounded_rectangle([0, 0, S - 1, S - 1], radius=R, fill=255)
img.putalpha(mask)

draw = ImageDraw.Draw(img, 'RGBA')

# subtle inner border removed for light-theme compatibility

# --- spark above the pot ---
spark_cx, spark_cy = S // 2, 1080
spark_outer, spark_inner = 300, 92
spark = []
for i in range(8):
    ang = -np.pi / 2 + i * np.pi / 4
    rad = spark_outer if i % 2 == 0 else spark_inner
    spark.append((spark_cx + rad * np.cos(ang), spark_cy + rad * np.sin(ang)))
# glow
glow_layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
gdraw = ImageDraw.Draw(glow_layer)
gdraw.polygon(spark, fill=(34, 211, 238, 180))
glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(55))
img.alpha_composite(glow_layer)
draw.polygon(spark, fill=(224, 255, 255, 255))

# --- pot ---
white = (255, 255, 255, 255)
offwhite = (241, 245, 249, 255)
shadow = (15, 23, 42, 70)

# body (slightly tapered look via rounded rect + bottom ellipse)
body = [1180, 1690, S - 1180, 3140]
draw.rounded_rectangle(body, radius=250, fill=white)
# bottom shading
draw.rounded_rectangle([1220, 2760, S - 1220, 3100], radius=190, fill=(226, 232, 240, 255))
# re-draw body top area to keep crisp white
draw.rounded_rectangle([1180, 1690, S - 1180, 2860], radius=250, fill=white)

# rim
draw.rounded_rectangle([980, 1500, S - 980, 1760], radius=125, fill=offwhite)
draw.rounded_rectangle([1000, 1516, S - 1000, 1738], radius=110, fill=white)
# rim shadow
draw.rounded_rectangle([1040, 1722, S - 1040, 1770], radius=24, fill=(203, 213, 225, 255))

# handles: solid rounded tabs left/right
draw.rounded_rectangle([780, 1910, 1195, 2400], radius=150, fill=white)
draw.rounded_rectangle([S - 1195, 1910, S - 780, 2400], radius=150, fill=white)
# handle inner shadow
draw.rounded_rectangle([835, 2000, 1140, 2310], radius=100, fill=(226, 232, 240, 255))
draw.rounded_rectangle([S - 1140, 2000, S - 835, 2310], radius=100, fill=(226, 232, 240, 255))

# --- letter A (geometric, crisp) ---
A = (34, 211, 238, 255)  # cyan-400
# Outer triangle-ish A with a crossbar, built from polygons so it stays crisp when downscaled.
apex_y, base_y = 2010, 2800
half_w = 430
stem = 150
left_outer = (S // 2 - half_w, base_y)
left_inner = (S // 2 - half_w + stem, base_y)
right_outer = (S // 2 + half_w, base_y)
right_inner = (S // 2 + half_w - stem, base_y)
apex_inner = (S // 2, apex_y + 250)
apex_outer = (S // 2, apex_y)
# left leg
draw.polygon([apex_outer, (S // 2 - 150 + 0, apex_y + 330), left_inner, left_outer], fill=A)
# right leg
draw.polygon([apex_outer, (S // 2 + 150, apex_y + 330), right_inner, right_outer], fill=A)
# crossbar
draw.rectangle([S // 2 - 300, 2505, S // 2 + 300, 2635], fill=A)

# --- soft bottom shadow inside the rounded square ---
sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
sdraw = ImageDraw.Draw(sh)
sdraw.ellipse([980, 3180, S - 980, 3400], fill=(10, 10, 30, 55))
sh = sh.filter(ImageFilter.GaussianBlur(48))
img.alpha_composite(sh)

# --- downscale to 1024 and save ---
final = img.resize((1024, 1024), Image.LANCZOS)
final.save(os.path.join(OUT_DIR, 'icon.png'), 'PNG')
# Windows icon with standard sizes
final.save(os.path.join(OUT_DIR, 'icon.ico'), format='ICO', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(24,24),(16,16)])
# also a 256 png for README / tray fallback
final.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT_DIR, 'icon-256.png'), 'PNG')
print('saved', final.size)
