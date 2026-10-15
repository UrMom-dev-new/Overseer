/** Aggregate source metadata without mutating the established provider registry. */
export * from './source-manifest-base';
import { SOURCE_CAPABILITIES as BASE_CAPABILITIES, type SourceCapability } from './source-manifest-base';
import { RANSOMWARE_CAPABILITY } from './ransomware-source';
import { INFRASTRUCTURE_CAPABILITIES } from './infrastructure-source';

export const SOURCE_CAPABILITIES: SourceCapability[] = [...BASE_CAPABILITIES, RANSOMWARE_CAPABILITY, ...INFRASTRUCTURE_CAPABILITIES];

export function getCapability(id: string): SourceCapability | undefined {
  return SOURCE_CAPABILITIES.find((capability) => capability.id === id);
}
