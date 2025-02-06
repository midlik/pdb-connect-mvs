import { MVSData, MVSData_State } from 'molstar/lib/extensions/mvs/mvs-data';
import type * as Builder from 'molstar/lib/extensions/mvs/tree/mvs/mvs-builder';
import { Color } from 'molstar/lib/mol-util/color';
import { ApiDataProvider, IDataProvider } from './data-provider';
import { applyEntityColors, applyStandardComponents, applyStandardComponentsForEntity, applyStandardRepresentations, decideEntityType, getEntityColors } from './helpers';


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
            out.push(...await this.listSnapshots(entryId, k));
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
        description.push(`- **View kind:** ${spec.kind}`);
        description.push(`- **View params:** ${JSON.stringify(spec.params)}`);
        return builder.getState({ title: spec.name, description: description.join('\n\n') });
    }

    private async loadEntry(model: Builder.Parse, outDescription: string[], params: SnapshotSpecParams['entry']) {
        const struct = model.modelStructure();
        struct.component().focus();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(struct, { modifiedResidues });
        const representations = applyStandardRepresentations(components, { opacityFactor: 1 });

        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        for (const repr of Object.values(representations)) {
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
        const components = applyStandardComponents(struct, { modifiedResidues });
        const representations = applyStandardRepresentations(components, { opacityFactor: 1 });

        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        for (const repr of Object.values(representations)) {
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
        const components = applyStandardComponents(struct, { modifiedResidues });
        const representations = applyStandardRepresentations(components, { opacityFactor: 0.3 }); // TODO compute smart opacity from structure size, like in PDBImages

        for (const repr of Object.values(representations)) {
            repr.color({ color: 'gray' });
        }

        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        const entityType = decideEntityType(entities[params.entityId]);

        const entityComponents = applyStandardComponentsForEntity(struct, params.entityId, entityType, { modifiedResidues });
        const entityRepresentations = applyStandardRepresentations(entityComponents, { opacityFactor: 1 });
        for (const repr of Object.values(entityRepresentations)) {
            repr.color({ color: Color.toHexStyle(entityColors[params.entityId]) as any });
        }

        outDescription.push(`## Entity ${params.entityId}`);
        const entityName = entities[params.entityId].names[0];
        outDescription.push((entityName ? `__${entityName}__` : '*Entity name not available*') + ` (${entityType})`);
        if (theAssembly === preferredAssembly) {
            outDescription.push(`Showing in assembly ${theAssembly} (preferred).`);
        } else if (theAssembly !== undefined) {
            outDescription.push(`Showing in assembly ${theAssembly} (entity not present in the preferred assembly ${preferredAssembly}).`);
        } else {
            outDescription.push(`Showing in the deposited model (entity not present in any assembly).`);
        }
    }
}


/** Return a new MVSSnapshotProvider taking data from PDBe API (https://www.ebi.ac.uk/pdbe/api) */
export function getDefaultMVSSnapshotProvider(): MVSSnapshotProvider {
    const dataProvider = new ApiDataProvider('https://www.ebi.ac.uk/pdbe/api/');
    return new MVSSnapshotProvider(dataProvider);
}


/*
NOTES:

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

Questions:
- We still don't have nstd_flag=. residues in modres API (e.g. 1gkt)
  - Currently showing them as ligand in whole-struct visual, not showing them in entity visual
  - If we want them in entity visual, we need at least one of:
    - have them in API
    - run a structure query in MVS producer
    - support MolQL in MVS
    - support nested components in MVS
    - support simplified query algebra in MVS


-------------------------------------------------------

Components and representations:

Whole entry/assembly:
- polymer: polymerCartoon
- branched: branchedCarbohydrate, branchedSticks (includes linking residue; _entity.type=branched + list of selected CCDs)
- branchedLinkage: branchedLinkageSticks (only needed if we do not show branchedSticks)
- ligand: ligandSticks (includes linking residue; includes nstd_flag=.)
- ion: ionSticks (includes linking residue)
- nonstandard: nonstandardSticks (based on API data, only nstd_flag=n)
- water: waterSticks

Entity:
* case type 'polymer':
    - polymer: polymerCartoon
    - nonstandard: nonstandardSticks
* case type 'branched':
    - branched: branchedCarbohydrate, branchedSticks (wo linking residue; includes API "molecule_type": "carbohydrate polymer" + list of selected CCDs)
* case type 'ligand':
    - ligand: ligandSticks (wo linking residue)
* case type 'ion':
    - ion: ionSticks (wo linking residue)
* case type 'water':
    - water: waterSticks

*/
