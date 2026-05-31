# Patient video assets

## Naming convention

| File pattern | Purpose |
|---|---|
| `breathing_01.mp4`, `breathing_02.mp4`, … | Idle breathing loops (random pool) |
| `death.mp4` | Deterioration sequence (plays once, holds last frame) |

Drop raw `.mp4` files into `C:\Users\steve\Downloads\`, then from the project root run:

```bash
python setup_videos.py
```

The script copies, renames, and updates the `idleVideos` array in `assets/js/scene.js` automatically.

Manual naming (if needed): `breathing_01.mp4`, `breathing_02.mp4`, … and `death.mp4`.
