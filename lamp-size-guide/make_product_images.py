import compose, subprocess, os
JOBS = [  # handle, photo, H, W
    ("mocha-lamp", "mocha_00", 31.5, 16), ("mocha-lamp-natural", "mocha_10", 31.5, 16),
    ("matcha-lamp", "matcha_09", 30, 15),
    ("bubble-lamp-natural", "bubble_19", 23, 15), ("bubble-lamp-mandarin", "bubble_14", 23, 15),
    ("bubble-lamp-lemon", "bubble_11", 23, 15), ("bubble-lamp-candy", "bubble_24", 23, 15),
    ("cloud-lamp", "cloud_00", 21, 15),
]
names = []
for h, p, H, W in JOBS:
    n = f"{h}-dimensions"
    open(f"out/{n}.svg", "w").write(compose.single(h, p, H, W, cord="2 m"))
    names.append(n)
env = dict(os.environ, VW="2048", NODE_PATH=subprocess.check_output(["npm", "root", "-g"]).decode().strip())
subprocess.run(["node", "render.js", *names], env=env, check=True)
for n in names:
    subprocess.run(["convert", f"out/{n}.png", "-quality", "92", f"out/{n}.jpg"], check=True)
subprocess.run(["montage", *[f"out/{n}.png" for n in names], "-geometry", "400x400+6+6", "-tile", "4x", "out/batch_preview.jpg"], check=True)
