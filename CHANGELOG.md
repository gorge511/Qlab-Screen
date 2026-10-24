# Changelog

## 0.2.0

- Show live elapsed and remaining time for running audio and video cues.
- Show only the cue that is actually playing, without the containing group or duplicate running entry.
- Show the QLab playhead on the monitor and highlight it in the cue list.
- Scroll to the running cue, or to the playhead when nothing is running.
- Show the next two cues on the TV dashboard, including the first cues inside a group.
- Use an amber "Next up" layout when nothing is running, and a green "Now running" layout during playback.
- Show the parent group name separately from the cue name.
- Add cue type icons, including speaker for audio and film strip for video.
- Reload cue names every 30 seconds so renames appear without restarting the server.
- Use 24-hour time and whole-second cue timers.
- Fit the workspace title to the space beside the page controls.
- Update the server dependencies, including dotenv 18. Electron packages are unchanged.

## 0.1.0

- Initial read-only QLab monitor, TV dashboard, admin settings, and viewer tracking.
