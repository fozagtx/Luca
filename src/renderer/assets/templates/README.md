# Template previews

Each template on the start screen (see `TEMPLATES` in `src/shared/styles.ts`) shows an example
video here. Name the file after the template's id and it is picked up automatically, no code
changes needed:

| Template        | Video                                           | Poster (optional)                 |
| --------------- | ----------------------------------------------- | --------------------------------- |
| Viral TikTok    | `tiktok-viral.mp4` (or `.webm`, `.mov`, `.m4v`) | `tiktok-viral.jpg`/`.png`/`.webp` |
| Viral explainer | `explainer-viral.mp4`                           | `explainer-viral.jpg`             |

The video plays muted and loops while the card is hovered; the poster (or the video's first
frame) shows otherwise. Keep them short and light (a few seconds, H.264 MP4, a few MB): they
ship inside the app. Without a video the card plays an animated storyboard of the template's
beats instead.
