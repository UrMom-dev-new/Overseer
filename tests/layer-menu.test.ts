import test from 'node:test';
import assert from 'node:assert/strict';

import { getLayerGroups, layerMenuEntries, layerMenuGroupForKey } from '../src/lib/layer-menu';
import { SOURCE_CAPABILITIES } from '../src/lib/source-manifest';

test('source-backed map feeds are present in the layer menu', () => {
  const menuKeys = new Set<string>(layerMenuEntries().map((entry) => entry.key));
  const layerIds = SOURCE_CAPABILITIES
    .map((capability) => capability.layerId)
    .filter((layerId): layerId is string => Boolean(layerId));

  for (const layerId of layerIds) {
    assert.equal(menuKeys.has(layerId), true, `${layerId} is missing from the layer menu`);
  }
});

test('satellite tracking is binned as space, not maritime', () => {
  assert.equal(layerMenuGroupForKey('satellites')?.label, 'SPACE');
  assert.equal(layerMenuGroupForKey('maritime')?.label, 'SEA');

  const maritimeGroup = getLayerGroups('core').find((group) => group.label === 'SEA');
  assert.ok(maritimeGroup);
  assert.equal(maritimeGroup.layers.some((layer) => layer.key === 'satellites'), false);
});

test('news source reports have their own visible menu toggle', () => {
  const intelGroup = getLayerGroups('core').find((group) => group.label === 'INTEL');
  assert.ok(intelGroup);
  assert.ok(intelGroup.layers.some((layer) => layer.key === 'news_intel'));
});
