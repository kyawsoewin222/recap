# Narration timing review sample

Open `sample.mp4` with `sample.srt` in a player that supports external subtitles.
The 6.2-second source excerpt comes from the beginning of the local part9 video.
The sample has 5.4 seconds of natural-rate Thiha narration and a 0.28-second frame-rounded pause; video plays at about 1.09x. The container has an additional ~21 ms of AAC padding.

Native Edge WordBoundary metadata drives the subtitle cue (0.1625–4.6 seconds); it does not stretch across trailing silence. `narration.json` preserves the original boundary metadata. `source.mp4` and `narration.mp3` are reproducible test inputs.

Sample Burmese:
လုရှောင်က စာချုပ်မချုပ်ခင် ဖမ်းခေါ်ခံရတဲ့ ပြည်သူထောင်ချီ ဘယ်မှာလဲလို့ မေးလိုက်ပါတယ်။

This is a shortened first-segment review fixture, not an approved translation. It retains Lu Xiao asking where thousands of abducted civilians are before the treaty. Compare against the original script and footage for the border/northern-raider context and the peace-treaty meaning before approving the wording. No full project was processed.

The installed FFmpeg lacks libass: this MP4 has narration and the existing subtitle mask, while Burmese subtitles are in the sidecar SRT. Burned-in visual layout has not been verified. `frame.png` verifies the exported footage/crop only. Browser automation was unavailable; human listening and story-meaning approval remain required.

Reproduce with a running `npm run dev`, then `npx tsx scripts/verify-recap.ts`. That script verifies both render input modes, stale/missing narration, rejection of an impossible fit, common subtitle cues, and four-segment drift. A libass-enabled FFmpeg also exercises the burned-subtitle path; otherwise its actionable error is checked.
