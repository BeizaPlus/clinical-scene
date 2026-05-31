# Patient video assets

## Naming convention

| File pattern | Purpose |
|---|---|
| `breathing_01.mp4`, `breathing_02.mp4`, … | Idle breathing loops (random pool) |
| `death.mp4` | Deterioration sequence (plays once, holds last frame) |

When you generate a new breathing clip, save it as `breathing_03.mp4`, `breathing_04.mp4`, etc., then add one line to the `idleVideos` array at the top of `assets/js/scene.js`:

```js
const idleVideos = [
  'assets/video/breathing_01.mp4',
  'assets/video/breathing_02.mp4',
  'assets/video/breathing_03.mp4', // ← add new files here
];
```

No other code changes needed.
