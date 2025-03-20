import * as Builder from 'molstar/lib/extensions/mvs/tree/mvs/mvs-builder';
import { IonNames } from 'molstar/lib/mol-model/structure/model/types/ions';
import { LipidNames } from 'molstar/lib/mol-model/structure/model/types/lipids';
import { SaccharideNames } from 'molstar/lib/mol-model/structure/model/types/saccharides';
import { ElementSymbolColors } from 'molstar/lib/mol-theme/color/element-symbol';
import { Color } from 'molstar/lib/mol-util/color';
import { ANNOTATION_COLORS, cycleIterator, ENTITY_COLORS, LIGAND_COLORS } from './colors';
import { DomainRecord, EntityRecord, ModifiedResidueRecord } from './data-provider';
import { ChainInfo } from './structure-info';


export type EntityType = 'polymer' | 'branched' | 'ligand' | 'ion' | 'water';

export type StandardComponentType = 'polymer' | 'branched' | 'branchedLinkage' | 'ligand' | 'ion' | 'nonstandard' | 'water';
export type StandardRepresentationType = 'polymerCartoon' | 'branchedCarbohydrate' | 'branchedSticks' | 'branchedLinkageSticks' | 'ligandSticks' | 'ionSticks' | 'nonstandardSticks' | 'waterSticks';

export type LigEnvComponentType = 'ligand' | 'environment' | 'wideEnvironment' | 'linkage';
export type LigEnvRepresentationType = 'ligandSticks' | 'environmentSticks' | 'linkageSticks' | 'wideEnvironmentCartoon';

export interface StandardComponentsOptions {
    modifiedResidues: ModifiedResidueRecord[],
}

export type StandardComponentCollection = { [type in StandardComponentType]?: Builder.Component };

export const StardardComponents: { [type in StandardComponentType]?: (struct: Builder.Structure, options: StandardComponentsOptions) => Builder.Component } = {
    polymer(structure: Builder.Structure) {
        return structure.component({ selector: 'polymer' });
    },
    branched(structure: Builder.Structure) {
        return structure.component({ selector: 'branched' });
    },
    branchedLinkage: undefined, // TODO select sugar linkage somehow if we want it (const sugarLinkageSticks = await this.nodes.branchedLinkage?.makeBallsAndSticks(options, ['branchedLinkageSticks']);)
    ligand(structure: Builder.Structure) {
        return structure.component({ selector: 'ligand' });
    },
    ion(structure: Builder.Structure) {
        return structure.component({ selector: 'ion' });
    },
    nonstandard(structure: Builder.Structure, options: StandardComponentsOptions) {
        return structure.component({ selector: options.modifiedResidues.map(r => ({ label_asym_id: r.labelAsymId, label_seq_id: r.labelSeqId })) });
    },
};

export interface StandardRepresentationsOptions {
    opacityFactor?: number,
}

export type StandardRepresentationCollection = { [type in StandardRepresentationType]?: Builder.Representation };

export const StandardRepresentations: { [type in StandardComponentType]?: (comp: Builder.Component, options: StandardRepresentationsOptions) => { [repr in StandardRepresentationType]?: Builder.Representation } } = {
    polymer(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            polymerCartoon: applyOpacity(component.representation({ type: 'cartoon' }), options.opacityFactor),
        };
    },
    branched(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            branchedCarbohydrate: applyOpacity(component.representation({ type: 'surface' }), 0.5 * (options.opacityFactor ?? 1)), // TODO add SNFG to MVS
            branchedSticks: applyOpacity(component.representation({ type: 'ball_and_stick' }), 0.8 * (options.opacityFactor ?? 1)),
        };
    },
    branchedLinkage(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            branchedLinkageSticks: applyOpacity(component.representation({ type: 'ball_and_stick' }), options.opacityFactor),
        };
    },
    ligand(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            ligandSticks: applyOpacity(component.representation({ type: 'ball_and_stick' }), options.opacityFactor),
        };
    },
    ion(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            ionSticks: applyOpacity(component.representation({ type: 'ball_and_stick' }), options.opacityFactor),
        };
    },
    nonstandard(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            nonstandardSticks: applyOpacity(component.representation({ type: 'ball_and_stick' }), options.opacityFactor),
        };
    },
    water(component: Builder.Component, options: StandardRepresentationsOptions) {
        return {
            waterSticks: applyOpacity(component.representation({ type: 'ball_and_stick' }), options.opacityFactor),
        };
    },
};


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

export type HexColor = `#{string}`; // for passing string colors to MVS

export function applyEntityColors(repr: Builder.Representation, colors: { [entityId: string]: string }) {
    for (const entityId in colors) {
        repr.color({
            selector: { label_entity_id: entityId },
            color: colors[entityId] as HexColor,
        });
    }
}

export function applyOpacity(repr: Builder.Representation, opacity: number | undefined) {
    if (opacity !== undefined && opacity !== 1) return repr.opacity({ opacity });
    else return repr;
}

export function getEntityColors(entities: { [entityId: string]: EntityRecord }): { [entityId: string]: string } {
    const polymerColorIterator = cycleIterator(ENTITY_COLORS);
    const ligandColorIterator = cycleIterator(LIGAND_COLORS);
    const waterColor = ElementSymbolColors.O;

    const out: { [entityId: string]: string } = {};

    for (const entityId of Object.keys(entities)) {
        const entity = entities[entityId];
        const color = entity.type === 'water' ? waterColor : entity.type === 'bound' ? ligandColorIterator.next().value! : polymerColorIterator.next().value!;
        out[entityId] = Color.toHexStyle(color);
        // TODO assign fixed colors to single-element ligands? (like in PDBImages)
    }
    return out;
}

export function getDomainColors(domains: { [source: string]: { [family: string]: { [entity: string]: DomainRecord[] } } }) {
    const colorIterator = cycleIterator(ANNOTATION_COLORS);
    const out: { [domainId: string]: string } = {};
    for (const [src, srcDomains] of Object.entries(domains)) {
        for (const [fam, famDomains] of Object.entries(srcDomains)) {
            for (const [entity, entityDomains] of Object.entries(famDomains)) {
                for (const domain of entityDomains) {
                    out[domain.id] = Color.toHexStyle(colorIterator.next().value!);
                }
            }
        }
    }
    return out;
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


export function objForEach<T extends Record<string, unknown>>(obj: T, action: (...args: Pair<T, keyof T>) => void): void {
    for (const key in obj) {
        (action as any)(key, obj[key]);
    }
}

const a = { x: 1, y: 2, name: 'hello' };
objForEach(a, (key, value) => {
    if (key === 'x') {
        value + 1;
        // value[0];
    }
    if (key === 'name') {
        // Math.round(value);
        value[0];
    }
})

type Pair<TObj extends Record<string, unknown>, TKey extends keyof TObj> =
    TKey extends keyof TObj
    ? [key: TKey, value: TObj[TKey]]
    : never; // extends clause needed to create discriminated union type properly
