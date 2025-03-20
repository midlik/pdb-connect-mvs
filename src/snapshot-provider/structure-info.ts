/** Function for extracting useful info from structure/model data. */

import { Model, Structure } from 'molstar/lib/mol-model/structure';
import { ModelSymmetry } from 'molstar/lib/mol-model-formats/structure/property/symmetry';


export type ChainInfo = { [labelChainId: string]: { authChainId: string, entityId: string } };

/** Return basic info about the chains in the model, mapped by label_asym_id */
export function getChainInfo(model: Model): ChainInfo {
    const result = {} as { [chainId: string]: { authChainId: string, entityId: string } };
    const chains = model.atomicHierarchy.chains;
    const nChains = chains._rowCount;
    for (let iChain = 0; iChain < nChains; iChain++) {
        const chainId = chains.label_asym_id.value(iChain);
        const authChainId = chains.auth_asym_id.value(iChain);
        const entityId = chains.label_entity_id.value(iChain);
        result[chainId] ??= { authChainId, entityId };
    }
    return result;
}


/** Return total number of polymer residues in an assembly or deposited model. */
export function structurePolymerResidueCount(model: Model, assemblyId: string | undefined) {
    const chainSizes = getChainPolymerResidueCounts(model);
    const chainCounts = getChainCountsInAssembly(model, assemblyId);
    let total = 0;
    for (const chainId in chainCounts) {
        total += (chainCounts[chainId] ?? 0) * (chainSizes[chainId] ?? 0);
    }
    return total;
}

function getChainCountsInAssembly(model: Model, assemblyId: string | undefined) {
    const chainCounts: { [labelChainId: string]: number } = {};
    if (assemblyId === undefined) {
        // Processing deposited model
        const nChains = model.atomicHierarchy.chains._rowCount;
        for (let i = 0; i < nChains; i++) {
            const chainId = model.atomicHierarchy.chains.label_asym_id.value(i);
            chainCounts[chainId] = 1;
        }
        return chainCounts;
    }
    const symmetry = ModelSymmetry.Provider.get(model);
    const assembly = symmetry?.assemblies.find(ass => ass.id.toLowerCase() === assemblyId?.toLowerCase());
    if (assembly === undefined) return {}; // non-existing assembly
    for (const group of assembly.operatorGroups) {
        if (!group.asymIds) continue;
        for (const chainId of group.asymIds) {
            chainCounts[chainId] ??= 0;
            chainCounts[chainId] += group.operators.length;
        }
    }
    return chainCounts;
}

function getChainPolymerResidueCounts(model: Model) {
    const { atomicHierarchy: h, entities } = model;
    const chainSizes: { [labelChainId: string]: number } = {};
    const nChains = h.chains._rowCount;
    for (let i = 0; i < nChains; i++) {
        const entityId = h.chains.label_entity_id.value(i);
        const entityType = entities.data.type.value(entities.getEntityIndex(entityId));
        if (entityType !== 'polymer') continue;

        const chainId = h.chains.label_asym_id.value(i);
        const fromAtom = h.chainAtomSegments.offsets[i];
        const toAtom = h.chainAtomSegments.offsets[i + 1];
        const fromRes = h.residueAtomSegments.index[fromAtom];
        const toRes = h.residueAtomSegments.index[toAtom - 1] + 1;
        const nRes = toRes - fromRes;
        chainSizes[chainId] = nRes;
    }
    return chainSizes;
}
