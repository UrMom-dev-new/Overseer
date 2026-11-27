# Offline Playback Verification

This Vite gallery mounts the actual production CameraViewer and LiveNewsViewer
components. It is not an application route, feed, provider, or production fallback.
All external requests are blocked by the tests. No test data ships in desktop
packages (electron-builder uses an explicit production file list).

The small MPEG-TS assets contain generated moving test patterns, with no people
or third-party footage. Regenerate with FFmpeg (not needed to run the tests):

```sh
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=10 -t 8 -an -c:v libx264 \
  -profile:v baseline -pix_fmt yuv420p -g 10 -keyint_min 10 -sc_threshold 0 \
  -f hls -hls_time 1 -hls_list_size 0 \
  -hls_segment_filename playback-tests/media/segment%d.mpegts playback-tests/media/vod.m3u8
```

Tests serve controlled HLS manifests over these segments, verifying actual decoded
frames and nonblank pixels, pause/close cleanup, VOD rejection, expired capture
time, failed requests, and blocked autoplay. YouTube tests use a controlled SDK
double to exercise callback, progress, expiry, recheck, retry, and teardown logic;
they do not claim that YouTube or any broadcaster is reachable or playing live.
The existing packaged-app and real-source gates remain separate checks.

```sh
pnpm exec playwright install chromium
pnpm run test:playback
```
