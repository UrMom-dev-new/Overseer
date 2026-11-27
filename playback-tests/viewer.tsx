import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CameraViewer from '../src/components/CameraViewer';
import LiveNewsViewer from '../src/components/LiveNewsViewer';
import { getLiveNewsFeed } from '../src/lib/live-news-catalog';
import './viewer.css';

function Viewer() {
  const [open, setOpen] = useState(true);
  const mode = new URLSearchParams(location.search).get('mode') || 'hls';
  const videoId = 'CameraLive1';
  const camera = { id: 'test-only', name: 'Deterministic test camera', stream_type: mode === 'youtube' ? 'iframe' : 'hls',
    stream_url: mode === 'youtube' ? `https://www.youtube.com/embed/${videoId}` : `${location.origin}/live.m3u8`,
    feed_url: `${location.origin}/snapshot.png`, external_url: 'https://example.com/provider' };
  return open ? mode === 'news' ? <LiveNewsViewer feed={getLiveNewsFeed('france24en')!} onClose={() => setOpen(false)} />
    : <CameraViewer camera={camera} onClose={() => setOpen(false)} /> : <p data-testid="closed">Closed</p>;
}
createRoot(document.getElementById('root')!).render(<Viewer />);
