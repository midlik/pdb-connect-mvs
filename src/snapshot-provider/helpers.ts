import * as Builder from 'molstar/lib/extensions/mvs/tree/mvs/mvs-builder';
import { IonNames } from 'molstar/lib/mol-model/structure/model/types/ions';
import { LipidNames } from 'molstar/lib/mol-model/structure/model/types/lipids';
import { SaccharideNames } from 'molstar/lib/mol-model/structure/model/types/saccharides';
import { ElementSymbolColors } from 'molstar/lib/mol-theme/color/element-symbol';
import { Color } from 'molstar/lib/mol-util/color';
import { cycleIterator, ENTITY_COLORS, LIGAND_COLORS } from './colors';
import { EntityRecord, ModifiedResidueRecord } from './data-provider';


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

export function applyEntityColors(repr: Builder.Representation, colors: { [entityId: string]: Color }) {
    for (const entityId in colors) {
        repr.color({
            selector: { label_entity_id: entityId },
            color: Color.toHexStyle(colors[entityId]) as any,
        });
    }
}

export function applyOpacity(repr: Builder.Representation, opacity: number | undefined) {
    if (opacity !== undefined && opacity !== 1) return repr.opacity({ opacity });
    else return repr;
}

export function getEntityColors(entities: { [entityId: string]: EntityRecord }): { [entityId: string]: Color } {
    const polymerColorIterator = cycleIterator(ENTITY_COLORS);
    const ligandColorIterator = cycleIterator(LIGAND_COLORS);
    const waterColor = ElementSymbolColors.O;

    const out: { [entityId: string]: Color } = {};

    for (const entityId of Object.keys(entities)) {
        const entity = entities[entityId];
        out[entityId] = entity.type === 'water' ? waterColor : entity.type === 'bound' ? ligandColorIterator.next().value! : polymerColorIterator.next().value!;
        // TODO assign fixed colors to single-element ligands? (like in PDBImages)
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
