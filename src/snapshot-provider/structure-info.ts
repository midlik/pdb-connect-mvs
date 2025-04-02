/** Function for extracting useful info from structure/model data. */

import { ModelSymmetry } from 'molstar/lib/mol-model-formats/structure/property/symmetry';
import { Model, ResidueIndex } from 'molstar/lib/mol-model/structure';


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

export function getElementsInEntities(model: Model) {
    const elementSets: { [entityId: string]: Set<string> } = {};
    const h = model.atomicHierarchy;
    const nAtoms = h.atoms._rowCount;
    for (let iAtom = 0; iAtom < nAtoms; iAtom++) {
        const element = h.atoms.type_symbol.value(iAtom);
        const iChain = h.chainAtomSegments.index[iAtom];
        const entityId = h.chains.label_entity_id.value(iChain);
        (elementSets[entityId] ??= new Set()).add(element);
    }
    const out: { [entityId: string]: string[] } = {};
    for (const entityId in elementSets) {
        out[entityId] = Array.from(elementSets[entityId]).sort();
    }
    return out;
}

/** Select surroundings of a chain in the model, as whole residues. */
export function chainSurroundings(model: Model, labelChainId: string, radius: number) {
    const h = model.atomicHierarchy;
    const coords = model.atomicConformation;

    const iChain = findChainIndexByLabelAsymId(model, labelChainId);
    if (iChain < 0) throw new Error(`Chain ${labelChainId} not found`);
    const fromAtom = h.chainAtomSegments.offsets[iChain];
    const toAtom = h.chainAtomSegments.offsets[iChain + 1];
    // Compute target bounding box
    const bbox = {
        xmin: coords.x[fromAtom],
        xmax: coords.x[fromAtom],
        ymin: coords.y[fromAtom],
        ymax: coords.y[fromAtom],
        zmin: coords.z[fromAtom],
        zmax: coords.z[fromAtom],
    };
    for (let iTgtAtom = fromAtom + 1; iTgtAtom < toAtom; iTgtAtom++) {
        bbox.xmin = Math.min(bbox.xmin, coords.x[iTgtAtom]);
        bbox.xmax = Math.max(bbox.xmax, coords.x[iTgtAtom]);
        bbox.ymin = Math.min(bbox.ymin, coords.y[iTgtAtom]);
        bbox.ymax = Math.max(bbox.ymax, coords.y[iTgtAtom]);
        bbox.zmin = Math.min(bbox.zmin, coords.z[iTgtAtom]);
        bbox.zmax = Math.max(bbox.zmax, coords.z[iTgtAtom]);
    };
    // Extend bounding box by radius
    bbox.xmin -= radius;
    bbox.xmax += radius;
    bbox.ymin -= radius;
    bbox.ymax += radius;
    bbox.zmin -= radius;
    bbox.zmax += radius;

    // Filter model atoms
    const outResidues: ResidueIndex[] = [];
    const sqRadius = radius ** 2;
    const nAtoms = h.atoms._rowCount;
    for (let iAtom = 0; iAtom < nAtoms; iAtom++) {
        // Don't include target in surroundings
        if (iAtom >= fromAtom && iAtom < toAtom) continue;
        // Pre-filter by bounding box
        const x = coords.x[iAtom];
        const y = coords.y[iAtom];
        const z = coords.z[iAtom];
        if (x < bbox.xmin) continue;
        if (x > bbox.xmax) continue;
        if (y < bbox.ymin) continue;
        if (y > bbox.ymax) continue;
        if (z < bbox.zmin) continue;
        if (z > bbox.zmax) continue;
        // Filter by distance to any target atom
        for (let iTgtAtom = fromAtom; iTgtAtom < toAtom; iTgtAtom++) {
            const sqDist = (x - coords.x[iTgtAtom]) ** 2 + (y - coords.y[iTgtAtom]) ** 2 + (z - coords.z[iTgtAtom]) ** 2;
            if (sqDist <= sqRadius) {
                const iRes = h.residueAtomSegments.index[iAtom];
                if (outResidues[outResidues.length - 1] !== iRes) {
                    outResidues.push(iRes);
                }
                break;
            }
        }
    }
    const out = [];
    for (const iRes of outResidues) {
        const iAtom = h.residueAtomSegments.offsets[iRes];
        const iChain = h.chainAtomSegments.index[iAtom];
        const label_asym_id = h.chains.label_asym_id.value(iChain);
        const label_seq_id = h.residues.label_seq_id.value(iRes);
        const auth_seq_id = h.residues.auth_seq_id.value(iRes);
        const pdbx_PDB_ins_code = h.residues.pdbx_PDB_ins_code.value(iRes);
        out.push({ label_asym_id, label_seq_id, auth_seq_id, pdbx_PDB_ins_code });
    }
    return out;
    // TODO think if we will need to run this on assemblies too (if so, it would just be easier to build structure and run query on it, StructureQueryHelper.run)
    // (or use API)
}

/** Return chain index or -1 if chain not found. */
function findChainIndexByLabelAsymId(model: Model, labelChainId: string): number {
    const h = model.atomicHierarchy;
    const nChains = h.chains.label_asym_id.rowCount;
    for (let i = 0; i < nChains; i++) {
        if (h.chains.label_asym_id.value(i) === labelChainId) {
            return i;
        }
    }
    return -1;
}

export function getBfactors(model: Model) {
    const nAtoms = model.atomicHierarchy.atoms._rowCount;
    const out = [];
    for (let iAtom = 0; iAtom < nAtoms; iAtom++) {
        const atom_id = model.atomicConformation.atomId.value(iAtom);
        const bfactor = model.atomicConformation.B_iso_or_equiv.value(iAtom);
        out.push({ atom_id, bfactor });
    }
    return out;
}
