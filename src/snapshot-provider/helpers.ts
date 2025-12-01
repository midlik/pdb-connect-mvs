import * as Builder from 'molstar/lib/extensions/mvs/tree/mvs/mvs-builder';
import { ColorT, HexColorT } from 'molstar/lib/extensions/mvs/tree/mvs/param-types';
import { IonNames } from 'molstar/lib/mol-model/structure/model/types/ions';
import { LipidNames } from 'molstar/lib/mol-model/structure/model/types/lipids';
import { SaccharideNames } from 'molstar/lib/mol-model/structure/model/types/saccharides';
import { ElementSymbolColors } from 'molstar/lib/mol-theme/color/element-symbol';
import { Color } from 'molstar/lib/mol-util/color';
import { ANNOTATION_COLORS, cycleIterator, ENTITY_COLORS, LIGAND_COLORS, MODRES_COLORS, WATER_COLOR } from './colors';
import { AssemblyRecord, DomainRecord, EntityRecord, ModifiedResidueRecord } from './data-provider';
import { ChainInfo, ChainInstancesInfo } from './structure-info';


export type EntityType = 'polymer' | 'branched' | 'ligand' | 'ion' | 'water';

export type StandardComponentType = 'polymer' | 'branched' | 'branchedLinkage' | 'ligand' | 'ion' | 'nonstandard' | 'water';
export type StandardRepresentationType = 'polymerCartoon' | 'branchedCarbohydrate' | 'branchedSticks' | 'branchedLinkageSticks' | 'ligandSticks' | 'ionSticks' | 'nonstandardSticks' | 'waterSticks';

export type LigEnvComponentType = 'ligand' | 'environment' | 'wideEnvironment' | 'linkage';
export type LigEnvRepresentationType = 'ligandSticks' | 'environmentSticks' | 'linkageSticks' | 'wideEnvironmentCartoon';

export interface StandardComponentsOptions {
    modifiedResidues: ModifiedResidueRecord[],
}

export type StandardComponentCollection = { [type in StandardComponentType]?: Builder.Component };

export const StardardComponents: { [type in StandardComponentType]?: (struct: Builder.Structure, options: StandardComponentsOptions) => Builder.Component | undefined } = {
    polymer(structure: Builder.Structure) {
        return structure.component({ selector: 'polymer', ref: 'component_polymer' });
    },
    branched(structure: Builder.Structure) {
        return structure.component({ selector: 'branched', ref: 'component_branched' });
    },
    branchedLinkage: undefined, // TODO select sugar linkage somehow if we want it (const sugarLinkageSticks = await this.nodes.branchedLinkage?.makeBallsAndSticks(options, ['branchedLinkageSticks']);)
    ligand(structure: Builder.Structure) {
        return structure.component({ selector: 'ligand', ref: 'component_ligand' });
    },
    ion(structure: Builder.Structure) {
        return structure.component({ selector: 'ion', ref: 'component_ion' });
    },
    nonstandard(structure: Builder.Structure, options: StandardComponentsOptions) {
        return structure.component({ selector: options.modifiedResidues.map(r => ({ label_asym_id: r.labelAsymId, label_seq_id: r.labelSeqId })), ref: 'component_nonstandard' });
    },
    water(structure: Builder.Structure) {
        return structure.component({ selector: 'water', ref: 'component_water' });
    },
};

export interface StandardRepresentationsOptions {
    opacityFactor?: number,
    skipComponents?: StandardComponentType[],
    sizeFactor?: number,
    custom?: Record<string, unknown>,
    refPrefix?: string,
}

export type StandardRepresentationCollection = { [type in StandardRepresentationType]?: Builder.Representation };

export const StandardRepresentations: { [type in StandardComponentType]?: (comp: Builder.Component, options: StandardRepresentationsOptions) => { [repr in StandardRepresentationType]?: Builder.Representation } } = {
    polymer(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            polymerCartoon: applyOpacity(component.representation({ type: 'cartoon', size_factor: options.sizeFactor, custom: options.custom, ref: makeRef(options.refPrefix, 'polymerCartoon') }), options.opacityFactor),
        };
    },
    branched(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            branchedCarbohydrate: applyOpacity(component.representation({ type: 'carbohydrate', size_factor: options.sizeFactor, custom: options.custom, ref: makeRef(options.refPrefix, 'branchedCarbohydrate') }), options.opacityFactor), // TODO change size factor for SNFG to 1.75 in Molstar MVS extension
            branchedSticks: applyOpacity(component.representation({ type: 'ball_and_stick', size_factor: options.sizeFactor, custom: options.custom, ref: makeRef(options.refPrefix, 'branchedSticks') }), 0.3 * (options.opacityFactor ?? 1)),
        };
    },
    branchedLinkage(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            branchedLinkageSticks: applyOpacity(component.representation({ type: 'ball_and_stick', size_factor: options.sizeFactor, custom: options.custom, ref: makeRef(options.refPrefix, 'branchedLinkageSticks') }), options.opacityFactor),
        };
    },
    ligand(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            ligandSticks: applyOpacity(component.representation({ type: 'ball_and_stick', size_factor: options.sizeFactor, custom: options.custom, ref: makeRef(options.refPrefix, 'ligandSticks') }), options.opacityFactor),
        };
    },
    ion(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            ionSticks: applyOpacity(component.representation({ type: 'ball_and_stick', size_factor: options.sizeFactor, custom: options.custom, ref: makeRef(options.refPrefix, 'ionSticks') }), options.opacityFactor),
        };
    },
    nonstandard(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            nonstandardSticks: applyOpacity(component.representation({ type: 'ball_and_stick', size_factor: options.sizeFactor, custom: options.custom, ref: makeRef(options.refPrefix, 'nonstandardSticks') }), options.opacityFactor),
        };
    },
    water(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            waterSticks: applyOpacity(component.representation({ type: 'ball_and_stick', size_factor: 0.5 * (options.sizeFactor ?? 1), custom: options.custom, ref: makeRef(options.refPrefix, 'waterSticks') }), 0.5 * (options.opacityFactor ?? 1)),
        };
    },
};

function makeRef(prefix: string | undefined, suffix: string | undefined) {
    if (prefix === undefined || suffix === undefined) return undefined;
    return `${prefix}_${suffix}`;
}


export function applyStandardComponents(struct: Builder.Structure, options: StandardComponentsOptions): StandardComponentCollection {
    const out: StandardComponentCollection = {};
    let compType: StandardComponentType;
    for (compType in StardardComponents) {
        const component = StardardComponents[compType]?.(struct, options);
        if (component) out[compType] = component;
    }
    return out;
}

export function applyStandardComponentsForEntity(struct: Builder.Structure, entityId: string, entityType: EntityType, options: StandardComponentsOptions): StandardComponentCollection {
    if (entityType === 'polymer') {
        return {
            polymer: struct.component({ selector: { label_entity_id: entityId } }),
            nonstandard: struct.component({ selector: options.modifiedResidues.filter(r => r.entityId === entityId).map(r => ({ label_asym_id: r.labelAsymId, label_seq_id: r.labelSeqId })) }),
        };
    } else {
        return {
            [entityType]: struct.component({ selector: { label_entity_id: entityId } }),
        };
    }
}

export function applyStandardComponentsForChain(struct: Builder.Structure, labelAsymId: string, instanceId: string | undefined, entityType: EntityType, options: StandardComponentsOptions): StandardComponentCollection {
    if (entityType === 'polymer') {
        const out: StandardComponentCollection = {};
        out.polymer = struct.component({ selector: { label_asym_id: labelAsymId, instance_id: instanceId } });
        const modifiedResiduesHere = options.modifiedResidues.filter(r => r.labelAsymId === labelAsymId);
        if (modifiedResiduesHere.length > 0) {
            out.nonstandard = struct.component({ selector: modifiedResiduesHere.map(r => ({ label_asym_id: r.labelAsymId, label_seq_id: r.labelSeqId, instance_id: instanceId })) });
        }
        return out;
    } else {
        return {
            [entityType]: struct.component({ selector: { label_asym_id: labelAsymId, instance_id: instanceId } }),
        };
    }
}

export function applyStandardComponentsForChains(struct: Builder.Structure, chains: string[], chainInfo: ChainInfo, entityInfo: { [entityId: string]: EntityRecord }, options: StandardComponentsOptions): StandardComponentCollection {
    const chainsForComponents: { [comp in StandardComponentType]?: string[] } = {};
    for (const chain of chains) {
        const entityId = chainInfo[chain].entityId;
        const entityType = decideEntityType(entityInfo[entityId]);
        if (entityType === 'water') continue;
        (chainsForComponents[entityType] ??= []).push(chain);
    }
    const out: StandardComponentCollection = {};
    for (const comp in chainsForComponents) {
        const chainsHere = chainsForComponents[comp as StandardComponentType];
        if (chainsHere === undefined || chainsHere.length === 0) continue;
        out[comp as StandardComponentType] = struct.component({ selector: chainsHere.map(c => ({ label_asym_id: c })) });
    }
    const chainSet = new Set(chains);
    out.nonstandard = struct.component({ selector: options.modifiedResidues.filter(r => chainSet.has(r.labelAsymId)).map(r => ({ label_asym_id: r.labelAsymId, label_seq_id: r.labelSeqId })) });
    return out;
}

export function applyStandardRepresentations(components: StandardComponentCollection, options: StandardRepresentationsOptions): StandardRepresentationCollection {
    const out: StandardRepresentationCollection = {};
    let compType: StandardComponentType;
    let reprType: StandardRepresentationType;
    for (compType in components) {
        if (options.skipComponents?.includes(compType)) continue;
        const component = components[compType];
        if (!component) continue;
        const representations = StandardRepresentations[compType]?.(component, options);
        if (!representations) continue;
        for (reprType in representations) {
            out[reprType] = representations[reprType];
        }
    }
    return out;
}

export function atomicRepresentations(reprs: StandardRepresentationCollection): Builder.Representation[] {
    return [reprs.ligandSticks, reprs.ionSticks, reprs.nonstandardSticks, reprs.branchedSticks, reprs.branchedLinkageSticks]
        .filter((repr => repr !== undefined) as ((repr: any) => repr is Builder.Representation));
    // not including waterSticks, because they are colored red anyway
}

export function applyEntityColors(repr: Builder.Representation, colors: { [entityId: string]: ColorT }) {
    repr.colorFromSource({ schema: 'all_atomic', category_name: 'entity', field_remapping: { label_entity_id: 'id' }, field_name: 'id', palette: { kind: 'categorical', colors: colors } });
}

export function applyElementColors(repr: Builder.Representation) {
    repr.colorFromSource({ schema: 'all_atomic', category_name: 'atom_site', field_name: 'type_symbol', palette: { kind: 'categorical', colors: 'ElementSymbol' } });
}

export function applyOpacity(repr: Builder.Representation, opacity: number | undefined) {
    if (opacity !== undefined && opacity !== 1) return repr.opacity({ opacity });
    else return repr;
}

export function getEntityColors(entities: { [entityId: string]: EntityRecord }): { [entityId: string]: ColorT } {
    const polymerColorIterator = cycleIterator(ENTITY_COLORS);
    const ligandColorIterator = cycleIterator(LIGAND_COLORS);

    const out: { [entityId: string]: ColorT } = {};

    for (const entityId of Object.keys(entities)) {
        const entity = entities[entityId];
        const color = entity.type === 'water' ? WATER_COLOR : entityIsLigand(entity) ? ligandColorIterator.next().value! : polymerColorIterator.next().value!;
        out[entityId] = color;
        // TODO assign fixed colors to single-element ligands? (like in PDBImages)
    }
    return out;
}

export function getDomainColors(domains: { [source: string]: { [family: string]: { [entity: string]: DomainRecord[] } } }) {
    const colorIterator = cycleIterator(ANNOTATION_COLORS);
    const out: { [domainId: string]: ColorT } = {};
    for (const [src, srcDomains] of Object.entries(domains)) {
        for (const [fam, famDomains] of Object.entries(srcDomains)) {
            for (const [entity, entityDomains] of Object.entries(famDomains)) {
                for (const domain of entityDomains) {
                    out[domain.id] = colorIterator.next().value!;
                }
            }
        }
    }
    return out;
}

export function getDomainFamilyColors(domains: { [source: string]: { [family: string]: { [entity: string]: DomainRecord[] } } }) {
    // Ignoring the possibility of families from different sources having the same ID (e.g. CATH and CATH-B)
    const colorIterator = cycleIterator(ANNOTATION_COLORS);
    const out: { [familyId: string]: ColorT } = {};
    for (const [src, srcDomains] of Object.entries(domains)) {
        for (const familyId in srcDomains) {
            out[familyId] = colorIterator.next().value!;
        }
    }
    return out;
}

export function getModresColors(modifiedResidues: ModifiedResidueRecord[]) {
    const colorIterator = cycleIterator(MODRES_COLORS);
    const out: { [compId: string]: HexColorT } = {};
    for (const modres of uniqueModresCompIds(modifiedResidues)) {
        out[modres] = colorIterator.next().value! as HexColorT;
    }
    return out;
}

export function uniqueModresCompIds(modifiedResidues: ModifiedResidueRecord[]) {
    return Array.from(new Set(modifiedResidues.map(r => r.compoundId))).sort();
}

export function decideEntityType(entityInfo: EntityRecord): EntityType {
    if (entityInfo.type === 'water') {
        return 'water';
    }
    if (entityInfo.type === 'bound') {
        if (entityInfo.compIds.length === 1 && SaccharideNames.has(entityInfo.compIds[0])) {
            // TODO should we treat lipids in a special way? src/mol-model/structure/model/types/lipids.ts
            return 'branched';
        } else if (entityInfo.compIds.length === 1 && IonNames.has(entityInfo.compIds[0])) {
            return 'ion';
        } else {
            return 'ligand';
        }
    }
    if (entityInfo.type === 'carbohydrate polymer') { // TODO check what values `type` can have
        return 'branched';
    }
    return 'polymer';
}

/** Parameter for structure-size-dependent opacity, used for entity images */
const SMART_FADED_OPACITY_PARAMS = {
    targetOpacity: 0.9, // ~ desired opacity of the structure as a whole
    baseOpacity: 0.05, // minimum opacity (for infinitely large structure)
    n0: 100, // artificial offset of residue count
}; // This will result in opacity ~0.4 for tiny structures, ~0.05 for huge structures

/** Calculate optimal opacity of a visual based on structure size. */
export function smartFadedOpacity(nPolymerResidues: number, params: typeof SMART_FADED_OPACITY_PARAMS = SMART_FADED_OPACITY_PARAMS) {
    const { targetOpacity, baseOpacity, n0 } = params;
    // The formula is derived from Lamber-Beer law:
    // -log(1 - targetOpacity) = -log(I/I0) = A = epsilon c l,
    // assuming that optical path length l is proportional to cube root of residue count.
    // This is of course very simplified.
    // Artificial parameters `n0` and `baseOpacity` are to avoid too high/low opacity for tiny/huge structures.
    const theoreticalOpacity = 1 - (1 - targetOpacity) ** (1 / (n0 + nPolymerResidues) ** (1 / 3));
    return baseOpacity + theoreticalOpacity;
}

export function listEntityInstancesInAssembly(entity: EntityRecord, chainInstancesInfo: ChainInstancesInfo[string]) {
    const out = [] as { labelAsymId: string, instanceId: string | undefined }[];
    const entityChains = new Set(entity.chains);
    for (const instanceId of chainInstancesInfo.allOperators) {
        for (const labelAsymId of chainInstancesInfo.chainsPerOperator[instanceId]) {
            if (entityChains.has(labelAsymId)) {
                out.push({ labelAsymId, instanceId });
            }
        }
    }
    return out;
}
export function listEntityInstancesInModel(entity: EntityRecord) {
    const out = [] as { labelAsymId: string, instanceId: string | undefined }[];
    for (const labelAsymId of entity.chains) {
        out.push({ labelAsymId, instanceId: undefined });
    }
    return out;
}

/** Set of entity types as reported by the `molecules` API, corresponding to macromolecules */
export const MacromoleculeTypes = new Set([
    'polypeptide(D)', // e.g. 7pcj
    'polypeptide(L)', // e.g. 7pcj
    'polydeoxyribonucleotide', // e.g. 7v6v
    'polyribonucleotide', // e.g. 1y26
    'polydeoxyribonucleotide/polyribonucleotide hybrid', // e.g. 5vze
    'peptide nucleic acid', // e.g. 2kvj
    'cyclic-pseudo-peptide', // not found in mmCIFs, but listed in controlled vocabulary for _entity_poly.type 
    'other', // maybe not found in mmCIFs, but listed in controlled vocabulary for _entity_poly.type
    'carbohydrate polymer', // found in API
]);


export function entityIsMacromolecule(entity: EntityRecord): boolean {
    return MacromoleculeTypes.has(entity.type);
}
export function entityIsLigand(entity: EntityRecord): boolean {
    return entity.type === 'bound' && entity.compIds.length === 1;
}

export function getPreferredAssembly(assemblies: AssemblyRecord[]): AssemblyRecord {
    const preferred = assemblies.find(ass => ass.preferred);
    if (preferred === undefined) throw new Error('Could not find preferred assembly.');
    return preferred;
}


// Examples (zgrep in PDB mirror from 2023-05-04):
// - peptide nucleic acid :
//   - 2kvj
//   - wrongly annotated: 1pdt entity 2, 1nr8 entity 2, 2k4g entity 1, 1rru entity 1, 1pup entity 1, 1hzs entity 1, 1qpy entity 1, 1xj9 entity 1
//   - 7kzl entity 2 whuuut? (annotated as polypeptide(L))
