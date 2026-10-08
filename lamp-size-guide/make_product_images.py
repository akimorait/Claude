import compose, subprocess, os
JOBS = [  # handle, photo, H, W
    ("matcha-lamp", "own_matcha", 30, 15),
    ("bubble-lamp-mandarin", "own_mandarin", 23, 15), ("bubble-lamp-candy", "own_candy", 23, 15),
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
