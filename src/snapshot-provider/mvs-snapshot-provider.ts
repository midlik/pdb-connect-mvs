import { MVSData, MVSData_State } from 'molstar/lib/extensions/mvs/mvs-data';
import * as Builder from 'molstar/lib/extensions/mvs/tree/mvs/mvs-builder';
import { ElementSymbolColors } from 'molstar/lib/mol-theme/color/element-symbol';
import { Color } from 'molstar/lib/mol-util/color';
import { cycleIterator, ENTITY_COLORS, LIGAND_COLORS } from './colors';
import { SaccharideNames } from 'molstar/lib/mol-model/structure/model/types/saccharides';
import { ApiDataProvider, EntityRecord, IDataProvider, ModifiedResidueRecord } from './data-provider';


type SnapshotSpecParams = {
    entry: { entry: string },
    assembly: { entry: string, assemblyId: string },
    entity: { entry: string, entityId: string, assemblyId?: string },
}
type SnapshotKind = keyof SnapshotSpecParams;
const SnapshotKinds = ['entry', 'assembly', 'entity'] as const satisfies readonly SnapshotKind[];

export type SnapshotSpec<TKind extends SnapshotKind = SnapshotKind> =
    TKind extends SnapshotKind
    ? { kind: TKind, params: SnapshotSpecParams[TKind], name: string }
    : never; // extends clause needed to create discriminated union type properly


export class MVSSnapshotProvider {
    constructor(public readonly dataProvider: IDataProvider) { }

    listSnapshotKinds(): readonly SnapshotKind[] {
        return SnapshotKinds;
    }

    async listSnapshots(entryId: string, kind?: SnapshotKind): Promise<SnapshotSpec[]> {
        if (kind === undefined) return this.listAllSnapshots(entryId);
        const out: SnapshotSpec[] = [];
        switch (kind) {
            case 'entry':
                out.push({ kind: 'entry', name: `Entry`, params: { entry: entryId } });
                break;
            case 'assembly':
                const assemblies = await this.dataProvider.assemblies(entryId);
                for (const ass of assemblies) {
                    out.push({ kind: 'assembly', name: `Assembly ${ass.assemblyId}`, params: { entry: entryId, assemblyId: ass.assemblyId } });
                }
                break;
            case 'entity':
                const entities = await this.dataProvider.entities(entryId);
                for (const ent in entities) {
                    if (entities[ent].type === 'water') continue;
                    out.push({ kind: 'entity', name: `Entity ${ent}`, params: { entry: entryId, entityId: ent, assemblyId: undefined } });
                }
                break;
            default:
                throw new Error(`Invalid snapshot kind: ${kind}`);
        }
        return out;
    }

    private async listAllSnapshots(entryId: string): Promise<SnapshotSpec[]> {
        const out: SnapshotSpec[] = [];
        for (const k of this.listSnapshotKinds()) {
            out.push(... await this.listSnapshots(entryId, k));
        }
        return out;
    }

    async getSnapshot(spec: SnapshotSpec): Promise<MVSData_State> {
        const builder = MVSData.createBuilder();
        const model = builder
            .download({ url: `https://www.ebi.ac.uk/pdbe/entry-files/${spec.params.entry}_updated.cif` })
            .parse({ format: 'mmcif' });

        const description: string[] = [];
        switch (spec.kind) {
            case 'entry':
                await this.loadEntry(model, description, spec.params);
                break;
            case 'assembly':
                await this.loadAssembly(model, description, spec.params);
                break;
            case 'entity':
                await this.loadEntity(model, description, spec.params);
                break;
        }
        description.push('---');
        description.push(`**View kind:** ${spec.kind}`);
        description.push(`**View params:** ${JSON.stringify(spec.params)}`);
        return builder.getState({ title: spec.name, description: description.join('\n\n') });
    }

    private async loadEntry(model: Builder.Parse, outDescription: string[], params: SnapshotSpecParams['entry']) {
        const struct = model.modelStructure();
        struct.component().focus();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const reprs = applyStandardReprs(struct, { modifiedResidues });

        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        for (const repr of Object.values(reprs)) {
            applyEntityColors(repr, entityColors);
        }

        outDescription.push('## Deposited model');
    }


    private async loadAssembly(model: Builder.Parse, outDescription: string[], params: SnapshotSpecParams['assembly']) {
        const assembliesInfo = await this.dataProvider.assemblies(params.entry);
        const assInfo = assembliesInfo.find(ass => ass.assemblyId === params.assemblyId);
        const struct = model.assemblyStructure({ assembly_id: params.assemblyId });
        struct.component().focus();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const reprs = applyStandardReprs(struct, { modifiedResidues });

        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        for (const repr of Object.values(reprs)) {
            applyEntityColors(repr, entityColors);
        }

        outDescription.push(`## Assembly ${params.assemblyId}`);
        outDescription.push(`This assembly is a ${assInfo?.form}-${assInfo?.name}.`);
        if (assInfo?.preferred) outDescription.push(`This is the preferred assembly.`);
    }

    private async loadEntity(model: Builder.Parse, outDescription: string[], params: SnapshotSpecParams['entity']) {
        const assembliesInfo = await this.dataProvider.assemblies(params.entry);
        const preferredAssembly = assembliesInfo.find(ass => ass.preferred)?.assemblyId;
        // Find out which assembly contains this entity and select where to render (priority: preferred assembly > any assembly > deposited model)
        const entitiesInAssemblies = await this.dataProvider.entitiesInAssemblies(params.entry);
        const inAssemblies = entitiesInAssemblies[params.entityId]?.assemblies ?? [];
        const theAssembly = (preferredAssembly !== undefined && inAssemblies.includes(preferredAssembly))
            ? preferredAssembly
            : (inAssemblies.length > 0 ? inAssemblies[0] : undefined);

        const struct = theAssembly !== undefined ? model.assemblyStructure({ assembly_id: theAssembly }) : model.modelStructure();
        struct.component().focus();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const reprs = applyStandardReprs(struct, { modifiedResidues, opacityFactor: 0.3 }); // TODO compute smart opacity from structure size, like in PDBImages

        for (const repr of Object.values(reprs)) {
            repr.color({ color: 'gray' });
        }

        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        const entityType = decideEntityType(entities[params.entityId]);
        const entityComponent = struct.component({ selector: { label_entity_id: params.entityId } });
        const entityReprs = StandardRepresentations[entityType]?.(entityComponent, {}) ?? {};
        // .representation({ type: entityType === 'polymer' ? 'cartoon' : 'ball_and_stick' }) // TODO treat each entity type appropriately
        for (const repr of Object.values(entityReprs)) {
            repr.color({ color: Color.toHexStyle(entityColors[params.entityId]) as any });
        }
        // TODO decide repr type based on entity type

        outDescription.push(`## Entity ${params.entityId}`);
        const src = theAssembly === preferredAssembly
            ? `assembly ${theAssembly} (preferred)`
            : theAssembly !== undefined
                ? `assembly ${theAssembly} (entity not present in the preferred assembly ${preferredAssembly})`
                : 'the deposited model (entity not present in any assembly)';
        outDescription.push(`Showing in ${src}.`);
    }
}


type StandardComponentType = 'polymer' | 'branched' | 'branchedLinkage' | 'ligand' | 'ion' | 'nonstandard' | 'water';
type LigEnvComponentType = 'ligand' | 'environment' | 'wideEnvironment' | 'linkage';
type StandardVisualType = 'polymerCartoon' | 'branchedCarbohydrate' | 'branchedSticks' | 'branchedLinkageSticks' | 'ligandSticks' | 'ionSticks' | 'nonstandardSticks' | 'waterSticks';
type LigEnvVisualType = 'ligandSticks' | 'environmentSticks' | 'linkageSticks' | 'wideEnvironmentCartoon';



function decideEntityType(entityInfo: EntityRecord): StandardComponentType {
    if (entityInfo.type === 'water') {
        return 'water';
    }
    if (entityInfo.type === 'bound') {
        if (entityInfo.compIds.length === 1 && SaccharideNames.has(entityInfo.compIds[0])) {
            // TODO should we treat lipids in a special way? src/mol-model/structure/model/types/lipids.ts
            return 'branched';
        } else {
            return 'ligand';
        }
    }
    if (entityInfo.type === 'carbohydrate polymer') { // TODO check what values `type` can have
        return 'branched';
    }
    // TODO all types
    return 'polymer';
}

interface StandardComponentsOptions {
    modifiedResidues: ModifiedResidueRecord[],
}

const StardardComponents: { [type in StandardComponentType]?: (struct: Builder.Structure, options: StandardComponentsOptions) => Builder.Component } = {
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

interface StandardRepresentationsOptions {
    opacityFactor?: number,
}

const StandardRepresentations: { [type in StandardComponentType]?: (comp: Builder.Component, options: StandardRepresentationsOptions) => { [repr in StandardVisualType]?: Builder.Representation } } = {
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


function applyStandardReprs(struct: Builder.Structure, options: { modifiedResidues: ModifiedResidueRecord[], opacityFactor?: number }) {
    const reprs: { [repr in StandardVisualType]?: Builder.Representation } = {};
    let comp: StandardComponentType;
    for (comp in StardardComponents) {
        const component = StardardComponents[comp]?.(struct, options);
        if (!component) continue;
        const representations = StandardRepresentations[comp]?.(component, options);
        for (const rep in representations) {
            reprs[rep as StandardVisualType] = representations[rep as keyof typeof representations];
        }
    }
    return reprs;
}

function applyEntityColors(repr: Builder.Representation, colors: { [entityId: string]: Color }) {
    for (const entityId in colors) {
        repr.color({
            selector: { label_entity_id: entityId },
            color: Color.toHexStyle(colors[entityId]) as any,
        });
    }
}

function applyOpacity(repr: Builder.Representation, opacity: number | undefined) {
    if (opacity !== undefined && opacity !== 1) return repr.opacity({ opacity });
    else return repr;
}

function getEntityColors(entities: { [entityId: string]: EntityRecord }): { [entityId: string]: Color } {
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







/** Return a new MVSSnapshotProvider taking data from PDBe API (https://www.ebi.ac.uk/pdbe/api) */
export function getDefaultMVSSnapshotProvider(): MVSSnapshotProvider {
    console.log('getDefaultMVSSnapshotProvider')
    const dataProvider = new ApiDataProvider('https://www.ebi.ac.uk/pdbe/api/');
    return new MVSSnapshotProvider(dataProvider);
}

/*
All existing PDBImages states:
- Entry
- Assembly
- Entity
- Domains - possibility to show specific instance, perhaps
- Ligand env - with controled interactions (toggle individual interaction types, there is an API for this), with volumes (adjustable isovalue)
- Modres show individual instances
- Bfactor include tooltip
- Validation - we will have multiple validation metrics

- Prefer sticks over balls

New states:
- All ligands highlighted
- Interfaces (surface bubble + interacting residue sticks)
- PTMs maybe in the far future

More ideas:
- Custom highlight granularity in Molstar (to pick e.g. domains)
*/
