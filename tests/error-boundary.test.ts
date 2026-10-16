import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorBoundary from '../src/components/ErrorBoundary';

test('map initialization failures expose an actionable alert, not a blank map', () => {
  const boundary = new ErrorBoundary({ name: 'Map', children: 'map' });
  boundary.state = ErrorBoundary.getDerivedStateFromError(new Error('Failed to initialize WebGL'));
  const html = renderToStaticMarkup(boundary.render());
  assert.match(html, /data-testid="map-issue"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Check graphics support, then retry/);
  assert.match(html, /RETRY/);
  assert.doesNotMatch(html, /maplibregl-canvas/);
});

test('healthy content and non-map errors are never labeled as a map failure', () => {
  const healthy = new ErrorBoundary({ name: 'Map', children: 'healthy map content' });
  assert.equal(healthy.render(), 'healthy map content');
  const other = new ErrorBoundary({ name: 'Other', children: 'other' });
  other.state = ErrorBoundary.getDerivedStateFromError(new Error('Other failed'));
  const html = renderToStaticMarkup(other.render());
  assert.doesNotMatch(html, /map-issue/);
  assert.match(html, /Other failed/);
});
