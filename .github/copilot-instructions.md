# Project instructions

- All clips are fixed at exactly 30 seconds, including previews and future video exports. Use the shared constants in `lib/clip.ts`. Do not introduce duration/speed options unless the user explicitly changes this rule. Pausing a preview does not change its content duration.

- Use the Next.js app router for app features and API routes.
- Keep the FIT upload workflow focused on the eventual end goal: upload up to 100 FIT files, inspect the route data, and prepare for route rendering and video export.
- Prefer small, explicit modules in the app and lib folders instead of putting all logic in one file.
- Validate uploaded file count and file extensions before processing.
- Keep the initial version simple: upload UI, API validation, and a clear extension point for FIT parsing and video generation.
- Before claiming completion, run the project build and verify the app compiles successfully.
