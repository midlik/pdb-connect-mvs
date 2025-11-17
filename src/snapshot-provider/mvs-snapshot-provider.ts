import { MVSData, MVSData_State } from 'molstar/lib/extensions/mvs/mvs-data';
import type * as Builder from 'molstar/lib/extensions/mvs/tree/mvs/mvs-builder';
import { Model } from 'molstar/lib/mol-model/structure';
import { Color } from 'molstar/lib/mol-util/color';
import { ANNOTATION_COLORS, MODRES_COLORS, VALIDATION_COLORS } from './colors';
import { IDataProvider } from './data-provider';
import { applyElementColors, applyEntityColors, applyStandardComponents, applyStandardComponentsForChains, applyStandardComponentsForEntity, applyStandardRepresentations, decideEntityType, getDomainColors, getEntityColors, getModresColors, HexColor, smartFadedOpacity, StandardRepresentations, uniqueModresCompIds } from './helpers';
import { IModelProvider } from './model-provider';
import { chainSurroundings, getBfactors, getChainInfo, getElementsInEntities, structurePolymerResidueCount } from './structure-info';
import { ColorLists } from 'molstar/lib/mol-util/color/lists';


type SnapshotSpecParams = {
    // TODO think about how to deal with mandatory (hopefully exhaustible) params vs optional params
    entry: { entry: string },
    assembly: { entry: string, assemblyId: string },
    entity: { entry: string, entityId: string, assemblyId?: string },
    domain: { entry: string, source: string, familyId: string, entityId: string }, // source / family / entity / chain / instance
    ligand: { entry: string, compId: string, labelAsymId?: string },
    modres: { entry: string, compId: string },
    bfactor: { entry: string },
    validation: { entry: string },
}
type SnapshotKind = keyof SnapshotSpecParams;
const SnapshotKinds = ['entry', 'assembly', 'entity', 'domain', 'ligand', 'modres', 'bfactor', 'validation'] as const satisfies readonly SnapshotKind[];

export type SnapshotSpec<TKind extends SnapshotKind = SnapshotKind> =
    TKind extends SnapshotKind
    ? { kind: TKind, params: SnapshotSpecParams[TKind], name: string }
    : never; // extends clause needed to create discriminated union type properly


/** Level of opacity used for domain and ligand images */
const FADED_OPACITY = 0.5;

export class MVSSnapshotProvider {
    constructor(
        public readonly dataProvider: IDataProvider,
        public readonly modelProvider: IModelProvider,
        public readonly config: MVSSnapshotProviderConfig,
    ) { }

    listSnapshotKinds(): readonly SnapshotKind[] {
        return SnapshotKinds;
    }

    // Expecting that this will be used for one entry only, so this 1-model caching should be sufficient
    private _cachedEntryId?: string;
    private _cachedModel?: Model;
    private async getModel(entryId: string): Promise<Model> {
        if (entryId !== this._cachedEntryId || !this._cachedModel) {
            this._cachedEntryId = entryId;
            this._cachedModel = await this.modelProvider.getModel(entryId);
        }
        return this._cachedModel;
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
            case 'domain':
                const domains = await this.dataProvider.siftsMappingsByEntity(entryId);
                for (const source in domains) {
                    const srcDomains = domains[source];
                    for (const familyId in srcDomains) {
                        const famDomains = srcDomains[familyId];
                        for (const entityId in famDomains) {
                            out.push({ kind: 'domain', name: `Domain ${source} ${familyId} in entity ${entityId}`, params: { entry: entryId, source, familyId, entityId } });
                            // const entDomains = famDomains[entityId];
                            // for (const domain of entDomains) {
                            //     out.push({ kind: 'domain', name: `Domain ${domain.id}: ${source} ${familyId} in entity ${entityId}`, params: { entry: entryId, source, entityId, familyId } });
                            //     // TODO allow all-domain-in-chain view (with specific chain or auto) and specific-domain view?
                            // }
                        }
                    }
                }
                break;
            case 'ligand':
                const entities2 = await this.dataProvider.entities(entryId); // thank you switch for not letting me have the same var name again
                for (const ent in entities2) {
                    const entityRecord = entities2[ent];
                    if (entityRecord.type === 'bound' && entityRecord.compIds.length === 1) {
                        const compId = entityRecord.compIds[0];
                        out.push({ kind: 'ligand', name: `Ligand ${compId}`, params: { entry: entryId, compId, labelAsymId: undefined } });
                    }
                }
                break;
            case 'modres':
                const modifiedResidues = await this.dataProvider.modifiedResidues(entryId);
                for (const compId of uniqueModresCompIds(modifiedResidues)) {
                    out.push({ kind: 'modres', name: `Modified residue ${compId}`, params: { entry: entryId, compId } });
                }
                break;
            case 'bfactor':
                const experimentalMethods = await this.dataProvider.experimentalMethods(entryId);
                const isXray = experimentalMethods.some(method => method.toLowerCase().includes('diffraction'));
                if (isXray) {
                    out.push({ kind: 'bfactor', name: `B-factor`, params: { entry: entryId } });
                }
                break;
            case 'validation':
                out.push({ kind: 'validation', name: `Validation`, params: { entry: entryId } });
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
            .download({ url: this.config.PdbStructureUrlTemplate.replaceAll('{pdb}', spec.params.entry) })
            .parse({ format: this.config.PdbStructureFormat });

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
            case 'domain':
                await this.loadDomain(model, description, spec.params);
                break;
            case 'ligand':
                await this.loadLigand(model, description, spec.params);
                break;
            case 'modres':
                await this.loadModres(model, description, spec.params);
                break;
            case 'bfactor':
                await this.loadBfactor(model, description, spec.params);
                break;
            case 'validation':
                await this.loadValidation(model, description, spec.params);
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

        let theAssembly: string | undefined;
        if (params.assemblyId) {
            theAssembly = params.assemblyId;
        } else {
            // Find out which assembly contains this entity and select where to render (priority: preferred assembly > any assembly > deposited model)
            const entitiesInAssemblies = await this.dataProvider.entitiesInAssemblies(params.entry);
            const inAssemblies = entitiesInAssemblies[params.entityId]?.assemblies ?? [];
            theAssembly = (preferredAssembly !== undefined && inAssemblies.includes(preferredAssembly))
                ? preferredAssembly
                : (inAssemblies.length > 0 ? inAssemblies[0] : undefined);
        }

        const struct = theAssembly !== undefined ? model.assemblyStructure({ assembly_id: theAssembly }) : model.modelStructure();
        struct.component().focus();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(struct, { modifiedResidues });

        const modelData = await this.getModel(params.entry);
        const bgOpacity = smartFadedOpacity(structurePolymerResidueCount(modelData, theAssembly));
        const representations = applyStandardRepresentations(components, { opacityFactor: bgOpacity });

        for (const repr of Object.values(representations)) {
            repr.color({ color: 'gray' });
        }

        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        const entityType = decideEntityType(entities[params.entityId]);

        const entityComponents = applyStandardComponentsForEntity(struct, params.entityId, entityType, { modifiedResidues });
        const entityRepresentations = applyStandardRepresentations(entityComponents, { opacityFactor: 1 });
        for (const repr of Object.values(entityRepresentations)) {
            repr.color({ color: entityColors[params.entityId] as HexColor });
        }

        outDescription.push(`## Entity ${params.entityId}`);
        const entityName = entities[params.entityId].names[0];
        outDescription.push((entityName ? `__${entityName}__` : '*Entity name not available*') + ` (${entityType})`);
        if (theAssembly === preferredAssembly) {
            outDescription.push(`Showing in assembly ${theAssembly} (preferred).`);
        } else if (theAssembly !== undefined) {
            outDescription.push(`Showing in assembly ${theAssembly}.`);
        } else {
            outDescription.push(`Showing in the deposited model.`);
        }
    }

    private async loadDomain(model: Builder.Parse, outDescription: string[], params: SnapshotSpecParams['domain']) {
        const struct = model.modelStructure();

        const coverages = await this.dataProvider.authChainCoverages(params.entry);
        const domainInfo = await this.dataProvider.siftsMappingsByEntity(params.entry);
        const domainColors = getDomainColors(domainInfo); // TODO cache? (incl. many things that need to be computed just once, e.g. getChainInfo)

        const domainsInEntity = domainInfo[params.source][params.familyId][params.entityId];
        const shownAuthChain = max(domainsInEntity.map(dom => dom.chunks[0].authChainId), chain => coverages[chain]);
        const domainsInChain = domainsInEntity.filter(dom => dom.chunks[0].authChainId === shownAuthChain);
        struct.component({ selector: { auth_asym_id: shownAuthChain } }).focus();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);

        const modelData = await this.getModel(params.entry);
        const chainInfo = getChainInfo(modelData);
        const chainsToShow = Object.keys(chainInfo).filter(c => chainInfo[c].authChainId === shownAuthChain);
        const entitiesInfo = await this.dataProvider.entities(params.entry);
        const shownPolymerLabelChain = Object.keys(chainInfo).find(c => chainInfo[c].authChainId === shownAuthChain && decideEntityType(entitiesInfo[chainInfo[c].entityId]) === 'polymer');
        const components = applyStandardComponentsForChains(struct, chainsToShow, chainInfo, entitiesInfo, { modifiedResidues });
        const representations = applyStandardRepresentations(components, { opacityFactor: FADED_OPACITY })
        for (const repr of Object.values(representations)) {
            repr.color({ color: 'gray' });
        }
        for (const domain of domainsInChain) {
            const domainComp = struct.component({ selector: domain.chunks.map(chunk => ({ label_asym_id: chunk.chainId, beg_label_seq_id: chunk.startResidue, end_label_seq_id: chunk.endResidue })) });
            const modresInDomain = modifiedResidues.filter(r => r.labelAsymId === domain.chunks[0].chainId && domain.chunks.some(dom => (dom.startResidue ?? Infinity) <= r.labelSeqId && r.labelSeqId <= (dom.endResidue ?? -Infinity)));
            const modresComp = struct.component({ selector: modresInDomain.map(r => ({ label_asym_id: r.labelAsymId, label_seq_id: r.labelSeqId })) });
            const color = (domainColors[domain.id] ?? Color.toHexStyle(ANNOTATION_COLORS[0])) as HexColor;
            domainComp.representation({ type: 'cartoon' }).color({ color });
            modresComp.representation({ type: 'ball_and_stick' }).color({ color });
        }

        const chainDesc = shownAuthChain !== shownPolymerLabelChain ? `${shownPolymerLabelChain} [auth ${shownAuthChain}]` : shownPolymerLabelChain;
        outDescription.push(
            `## Domain ${params.source} ${params.familyId} in entity ${params.entityId}`,
            `PDB entry ${params.entry} contains ${domainsInEntity.length} ${domainsInEntity.length === 1 ? 'copy' : 'copies'} of ${params.source} domain ${params.familyId} in entity ${params.entityId}.`,
            `Showing ${domainsInChain.length} ${domainsInChain.length === 1 ? 'copy' : 'copies'} in chain ${chainDesc}.`,
        );
    }

    private async loadLigand(model: Builder.Parse, outDescription: string[], params: SnapshotSpecParams['ligand']) {
        const entities = await this.dataProvider.entities(params.entry);
        const entityRecord = Object.values(entities).find(ent => ent.compIds.length === 1 && ent.compIds[0] === params.compId);
        if (entityRecord === undefined) {
            outDescription.push(`Ligand ${params.compId} not found`);
            return;
        }
        let labelAsymId: string;
        if (params.labelAsymId) {
            if (!entityRecord.chains.includes(params.labelAsymId)) {
                outDescription.push(`Ligand ${params.compId} not found in chain ${params.labelAsymId}`);
                return;
            }
            labelAsymId = params.labelAsymId;
        } else {
            labelAsymId = entityRecord.chains[0];
        }

        const struct = model.modelStructure();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(struct, { modifiedResidues });

        const modelData = await this.getModel(params.entry);
        const bgOpacity = smartFadedOpacity(structurePolymerResidueCount(modelData, undefined));
        const representations = applyStandardRepresentations(components, { opacityFactor: bgOpacity });

        for (const repr of Object.values(representations)) {
            repr.color({ color: 'gray' });
        }
        const ligandComp = struct.component({ selector: { label_asym_id: labelAsymId } });

        const entityColors = getEntityColors(entities);
        const elementsInEntities = getElementsInEntities(modelData); // TODO consider just using all elements from the model
        const allElements = Array.from(new Set(Object.values(elementsInEntities).flat())).sort();
        const ligandRepr = ligandComp.representation({ type: 'ball_and_stick' }).color({ color: entityColors[entityRecord.id] as HexColor });
        applyElementColors(ligandRepr, elementsInEntities[entityRecord.id]);

        const LIGAND_ENVIRONMENT_RADIUS = 5;
        const environmentSelector = chainSurroundings(modelData, labelAsymId, LIGAND_ENVIRONMENT_RADIUS);
        const environmentComp = struct.component({ selector: environmentSelector });
        const environmentRepr = environmentComp.representation({ type: 'ball_and_stick', size_factor: 0.5 }).color({ color: 'gray' });
        applyElementColors(environmentRepr, allElements);
        environmentComp.focus();

        const chainInfo = getChainInfo(modelData);
        const authAsymId = chainInfo[labelAsymId].authChainId;

        outDescription.push(`## Ligand ${params.compId}`);
        outDescription.push(`Showing ligand **${entityRecord.names}** (${params.compId}) in chain ${labelAsymId} [auth ${authAsymId}] in the deposited model.`);
    }

    private async loadModres(model: Builder.Parse, outDescription: string[], params: SnapshotSpecParams['modres']) {
        const assembliesInfo = await this.dataProvider.assemblies(params.entry);
        const preferredAssembly = assembliesInfo.find(ass => ass.preferred)?.assemblyId; // preferred assembly

        const struct = preferredAssembly !== undefined ? model.assemblyStructure({ assembly_id: preferredAssembly }) : model.modelStructure();
        struct.component().focus();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(struct, { modifiedResidues });

        const modelData = await this.getModel(params.entry);
        const bgOpacity = smartFadedOpacity(structurePolymerResidueCount(modelData, preferredAssembly));
        const representations = applyStandardRepresentations(components, { opacityFactor: bgOpacity });

        for (const repr of Object.values(representations)) {
            repr.color({ color: 'gray' });
        }

        const modresComp = struct.component({
            selector: modifiedResidues.filter(r => r.compoundId === params.compId).map(r => ({ label_asym_id: r.labelAsymId, label_seq_id: r.labelSeqId })),
        });
        const modresRepr = modresComp.representation({ type: 'ball_and_stick' });
        const modresColors = getModresColors(modifiedResidues);
        modresRepr.color({ color: modresColors[params.compId] as HexColor ?? MODRES_COLORS[0] });

        const modresName = modifiedResidues.find(r => r.compoundId === params.compId)?.compoundName;
        outDescription.push(`## Modified residue ${params.compId}`);
        outDescription.push(modresName ? `__${modresName}__` : '*Modified residue name not available*');
        if (preferredAssembly !== undefined) {
            outDescription.push(`Showing in assembly ${preferredAssembly} (preferred).`);
        } else {
            outDescription.push(`Showing in the deposited model.`);
        }
    }

    private async loadBfactor(model: Builder.Parse, outDescription: string[], params: SnapshotSpecParams['bfactor']) {
        const struct = model.modelStructure();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(struct, { modifiedResidues });

        const modelData = await this.getModel(params.entry);
        const representations = applyStandardRepresentations(components, { skipComponents: ['polymer'] });
        representations.polymerCartoon = components.polymer?.representation({ type: 'cartoon' }); // TODO make this putty with size physical

        const bfactors = getBfactors(modelData);
        const RAINBOW_COLORS = ColorLists['simple-rainbow'].list.map(entry => typeof entry === 'number' ? entry : entry[0]);
        for (const repr of Object.values(representations)) {
            // repr.colorFromSource({ schema: 'all_atomic', category_name: 'atom_site', field_name: 'B_iso_or_equiv' }); // this could work if MVS supported color_mapping param
            for (const atom of bfactors) {
                const color = interpolateColor(atom.bfactor / 100, RAINBOW_COLORS);
                repr.color({ selector: { atom_id: atom.atom_id }, color: Color.toHexStyle(color) as HexColor });
            }
        }
        outDescription.push(`## B-factor`);
        outDescription.push(`Showing B-factor for the deposited model.`);
        outDescription.push(`**This is the dumbest implementation ever and should under no circumstances never ever be used in real life! Its only purpose is to demonstrate shortcomings of the current MVS feature set.**`);
    }

    private async loadValidation(model: Builder.Parse, outDescription: string[], params: SnapshotSpecParams['validation']) {
        const struct = model.modelStructure();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(struct, { modifiedResidues });
        const representations = applyStandardRepresentations(components, {});
        const reprList = Object.values(representations);

        const validationReport = await this.dataProvider.pdbeStructureQualityReport(params.entry);
        if (validationReport !== undefined) {
            for (const repr of Object.values(representations)) {
                repr.color({ color: VALIDATION_COLORS[0] }); // base color for residues without issues (not listed in the report)
            }
            for (const molecule of validationReport.molecules) {
                for (const chain of molecule.chains) {
                    for (const residue of chain.models[0].residues) {
                        const issueCount = Math.min(residue.outlier_types.length, 3) as 0 | 1 | 2 | 3;
                        for (const repr of reprList) {
                            repr.color({
                                selector: {
                                    label_asym_id: chain.struct_asym_id,
                                    label_seq_id: residue.residue_number,
                                    auth_seq_id: Number(residue.author_residue_number),
                                    pdbx_PDB_ins_code: residue.author_insertion_code,
                                },
                                color: VALIDATION_COLORS[issueCount],
                            });
                        }
                    }
                }
            }
            outDescription.push(`## Validation`);
            outDescription.push(`**PDBe Structure Quality Report:** Residues are coloured by the number of geometry outliers. Green - no outliers, yellow - one outlier, orange - two outliers, red - three or more outliers.`);
        } else {
            for (const repr of Object.values(representations)) {
                repr.color({ color: VALIDATION_COLORS.NOT_APPLICABLE });
            }
            outDescription.push(`## Validation`);
            outDescription.push(`PDBe Structure Quality Report not available for this entry.`);
        }
    }
}

function interpolateColor(value: number, colors: Color[]) {
    const n = colors.length - 1;
    const bin = Math.floor(value * n);
    if (bin === n) return colors[n];
    const fractional = value * n - bin;
    return Color.interpolate(colors[bin], colors[bin + 1], fractional);
}

function max<T, V>(array: T[], key: (elem: T) => V): T {
    let argMax = array[0];
    let max = key(argMax);
    for (const elem of array) {
        const value = key(elem)
        if (value > max) {
            argMax = elem;
            max = value;
        }
    }
    return argMax;
}

export interface MVSSnapshotProviderConfig {
    PdbApiUrlPrefix: string,
    PdbStructureUrlTemplate: string,
    PdbStructureFormat: 'bcif' | 'mmcif' | 'pdb',
}

export const DefaultMVSSnapshotProviderConfig = {
    PdbApiUrlPrefix: 'https://www.ebi.ac.uk/pdbe/api/',
    /** URL template for PDB structural data, '{pdb}' will be replaced by actual PDB ID. */
    PdbStructureUrlTemplate: 'https://www.ebi.ac.uk/pdbe/entry-files/{pdb}.bcif',
    /** Format for PDB structural data. */
    PdbStructureFormat: 'bcif',
} satisfies MVSSnapshotProviderConfig;

// /** Return a new MVSSnapshotProvider taking data from PDBe API (https://www.ebi.ac.uk/pdbe/api) */
// export function getDefaultMVSSnapshotProvider(config?: Partial<MVSSnapshotProviderConfig>): MVSSnapshotProvider {
//     const fullConfig: MVSSnapshotProviderConfig = { ...DefaultMVSSnapshotProviderConfig, ...config };
//     const dataProvider = new ApiDataProvider(fullConfig.PdbApiUrlPrefix);
//     return new MVSSnapshotProvider(dataProvider, fullConfig);
// }


/*
NOTES:

All existing PDBImages states:
- Entry
- Assembly
- Entity
- Domains - possibility to show specific instance, perhaps
  - Could have: more sofisticated view with whole structure / this chain / domains from other families / domains from this family / this domain instance
- Ligand env - with controled interactions (toggle individual interaction types, there is an API for this), with volumes (adjustable isovalue)
- Modres show individual instances
- Bfactor include tooltip
- Validation - we will have multiple validation metrics
  -> Sameer: use white instead of green, check color code for colorblindness
- Sugar SNFG color - keep as is (by-chain / by-entity), for the future potentially add option to use SNFG colors

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
