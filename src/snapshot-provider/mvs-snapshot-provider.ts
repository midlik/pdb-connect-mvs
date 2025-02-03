import { MVSData, MVSData_State } from 'molstar/lib/extensions/mvs/mvs-data';
import * as Builder from 'molstar/lib/extensions/mvs/tree/mvs/mvs-builder';
import { ElementSymbolColors } from 'molstar/lib/mol-theme/color/element-symbol';
import { Color } from 'molstar/lib/mol-util/color';
import { cycleIterator, ENTITY_COLORS, LIGAND_COLORS } from './colors';
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
        const entitiesInAssemblies = await this.dataProvider.entitiesInAssemblies(params.entry);
        const inAssemblies = entitiesInAssemblies[params.entityId]?.assemblies ?? [];
        const theAssembly = (preferredAssembly !== undefined && inAssemblies.includes(preferredAssembly))
            ? preferredAssembly
            : (inAssemblies.length > 0 ? inAssemblies[0] : undefined);

        const struct = theAssembly !== undefined ? model.assemblyStructure({ assembly_id: theAssembly }) : model.modelStructure();
        struct.component().focus();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const reprs = applyStandardReprs(struct, { modifiedResidues });

        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        for (const repr of Object.values(reprs)) {
            repr.color({ color: 'gray' }).opacity({ opacity: 0.3 }); // TODO compute smart opacity from structure size, like in PDBImages
        }
        struct
            .component({ selector: { label_entity_id: params.entityId } })
            .representation({ type: 'ball_and_stick' })
            .color({ color: Color.toHexStyle(entityColors[params.entityId]) as any });
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

function applyStandardReprs(struct: Builder.Structure, options: { modifiedResidues: ModifiedResidueRecord[], faded?: boolean }) {
    const polymerCartoon = struct.component({ selector: 'polymer' }).representation({ type: 'cartoon' });
    const ligandSticks = struct.component({ selector: 'ligand' }).representation({ type: 'ball_and_stick' });
    const ionSticks = struct.component({ selector: 'ion' }).representation({ type: 'ball_and_stick' });
    const nonstandardSticks = struct.component({ selector: options.modifiedResidues.map(r => ({ label_asym_id: r.labelAsymId, label_seq_id: r.labelSeqId })) }).representation({ type: 'ball_and_stick' });
    // These nonstandard residues will only contain info from API, TODO is it enough?
    const sugar = struct.component({ selector: 'branched' });
    const sugarSticks = sugar.representation({ type: 'ball_and_stick' });
    const sugarSnfg = sugar.representation({ type: 'surface' }); // TODO add SNFG to MVS
    // const sugarLinkageSticks = await this.nodes.branchedLinkage?.makeBallsAndSticks(options, ['branchedLinkageSticks']); // TODO select sugar linkage somehow if we want it

    const reprs = { polymerCartoon, ligandSticks, ionSticks, nonstandardSticks, sugarSticks, sugarSnfg };
    if (options.faded) {
        for (const repr of Object.values(reprs)) repr.opacity({ opacity: 1 });
    } else {
        reprs.sugarSticks.opacity({ opacity: 0.8 });
        reprs.sugarSnfg.opacity({ opacity: 0.5 });
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
