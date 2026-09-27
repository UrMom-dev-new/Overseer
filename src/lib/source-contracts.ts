/** Extend verification coverage while retaining the established evaluator unchanged. */
export * from './source-contracts-base';
import { SOURCE_CONTRACTS as BASE_CONTRACTS, type SourceContract } from './source-contracts-base';
import { RANSOMWARE_CONTRACT } from './ransomware-source';

export const SOURCE_CONTRACTS: SourceContract[] = [...BASE_CONTRACTS, RANSOMWARE_CONTRACT];
export const VERIFY_ROUTE_CONTRACTS = SOURCE_CONTRACTS.filter((contract) => contract.safeToProbe);
export const REQUIRED_CAPABILITY_IDS = SOURCE_CONTRACTS.filter((contract) => contract.requirement === 'required').map((contract) => contract.id);

export function getSourceContract(id: string): SourceContract | undefined {
  return SOURCE_CONTRACTS.find((contract) => contract.id === id);
}
