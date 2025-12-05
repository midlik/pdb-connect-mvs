import { MVSData } from 'molstar/lib/extensions/mvs/mvs-data';
import { MVSAnimationNodeParams } from 'molstar/lib/extensions/mvs/tree/animation/animation-tree';
import type * as Builder from 'molstar/lib/extensions/mvs/tree/mvs/mvs-builder';
import { ComponentExpressionT } from 'molstar/lib/extensions/mvs/tree/mvs/param-types';
import { ANNOTATION_COLORS, ATOM_INTERACTION_COLORS, CHAIN_ANNOTATED_COLOR, MODRES_COLORS, RESIDUE_ANNOTATED_COLOR, RESIDUE_HIGHLIGHT_COLOR, VALIDATION_COLORS } from './colors';
import { IDataProvider } from './data-provider';
import { applyElementColors, applyEntityColors, applyStandardComponents, applyStandardComponentsForChains, applyStandardComponentsForEntity, applyStandardRepresentations, atomicRepresentations, decideEntityType, entityIsLigand, getDomainColors, getDomainFamilyColors, getEntityColors, getModresColors, getPreferredAssembly, max, normalizeInsertionCode, smartFadedOpacity, StandardRepresentationType, unique } from './helpers';
import { IModelProvider } from './model-provider';
import { MODEL, PREFERRED, SnapshotSpec, SnapshotSpecParams } from './mvs-snapshot-types';
import { chainSurroundings, getChainInfo, getChainInstancesInAssemblies, structurePolymerResidueCount } from './structure-info';


/** Level of opacity used for domain and ligand images */
const FADED_OPACITY = 0.5;
/** Radius factor for focusing ligands and modified residues (radius = (bounding sphere radius) * factor + extent) */
const FOCUS_RADIUS_FACTOR = 1;
/** Radius extent for focusing ligands and modified residues (radius = (bounding sphere radius) * factor + extent) */
const FOCUS_RADIUS_EXTENT = 2.5;
/** Tube radius for atom interactions */
const INTERACTION_TUBE_RADIUS = 0.075;
/** Tube dash length for atom interactions */
const INTERACTION_TUBE_DASH_LENGTH = 0.1;
/** Nice names for atom interaction types */
export const INTERACTION_NICE_NAMES: Record<string, string> = {
    clash: 'Covalent clash',
    covalent: 'Covalent',
    vdw_clash: 'Van der Waals clash',
    vdw: 'Van der Waals',
    hbond: 'Hydrogen bond',
    xbond: 'Halogen bond',
    ionic: 'Ionic',
    metal_complex: 'Metal complex',
    aromatic: 'Aromatic',
    FF: 'Plane-Plane',
    hydrophobic: 'Hydrophobic',
    carbonyl: 'Carbonyl',
    polar: 'Polar',
    CARBONPI: 'Carbon-pi',
    CATIONPI: 'Cation-pi',
    DONORPI: 'Hydrogen bond donor-pi',
    HALOGENPI: 'Halogen-pi',
    METSULPHURPI: 'Methionine sulphur-pi',
    plane_plane: 'Plane-Plane',
    AMIDEAMIDE: 'Amide-Amide',
    AMIDERING: 'Amide-Ring',
    weak_polar: 'Weak polar',
    weak_hbond: 'Weak hydrogen bond',
};

interface BuilderContext {
    root: Builder.Root,
    model: Builder.Parse,
}

export class MVSSnapshotProvider {
    constructor(
        public readonly dataProvider: IDataProvider,
        public readonly modelProvider: IModelProvider,
        public readonly config: MVSSnapshotProviderConfig,
    ) { }

    async getSnapshot(spec: SnapshotSpec, asMultistate: boolean): Promise<MVSData> {
        const builder = MVSData.createBuilder();
        const model = builder
            .download({ url: this.config.PdbStructureUrlTemplate.replaceAll('{pdb}', spec.params.entry) })
            .parse({ format: this.config.PdbStructureFormat });

        const ctx: BuilderContext = { root: builder, model: model };

        const description: string[] = [];
        switch (spec.kind) {
            case 'entry':
                await this.loadEntry(ctx, description, spec.params);
                break;
            case 'assembly':
                await this.loadAssembly(ctx, description, spec.params);
                break;
            case 'entity':
                await this.loadEntity(ctx, description, spec.params);
                break;
            case 'domain':
                await this.loadDomain(ctx, description, spec.params);
                break;
            case 'ligand':
                await this.loadLigand(ctx, description, spec.params);
                break;
            case 'modres':
                await this.loadModres(ctx, description, spec.params);
                break;
            case 'bfactor':
                await this.loadBfactor(ctx, description, spec.params);
                break;
            case 'validation':
                await this.loadValidation(ctx, description, spec.params);
                break;
            case 'pdbconnect_summary_default':
                await this.loadPdbconnectSummaryDefault(ctx, description, spec.params);
                break;
            case 'pdbconnect_summary_macromolecule':
                await this.loadPdbconnectSummaryMacromolecule(ctx, description, spec.params);
                break;
            case 'pdbconnect_summary_all_ligands':
                await this.loadPdbconnectSummaryAllLigands(ctx, description, spec.params);
                break;
            case 'pdbconnect_summary_ligand':
                await this.loadPdbconnectSummaryLigand(ctx, description, spec.params);
                break;
            case 'pdbconnect_summary_domains_default':
                await this.loadPdbconnectSummaryDomainsDefault(ctx, description, spec.params);
                break;
            case 'pdbconnect_summary_domains_in_source':
                await this.loadPdbconnectSummaryDomainsInSource(ctx, description, spec.params);
                break;
            case 'pdbconnect_summary_domain':
                await this.loadPdbconnectSummaryDomain(ctx, description, spec.params);
                break;
            case 'pdbconnect_summary_all_modifications':
                await this.loadPdbconnectSummaryAllModifications(ctx, description, spec.params);
                break;
            case 'pdbconnect_summary_modification':
                await this.loadPdbconnectSummaryModification(ctx, description, spec.params);
                break;
            case 'pdbconnect_quality':
                await this.loadPdbconnectQuality(ctx, description, spec.params);
                break;
            case 'pdbconnect_environment':
                await this.loadPdbconnectEnvironment(ctx, description, spec.params);
                break;
            case 'pdbconnect_text_annotation':
                await this.loadPdbconnectTextAnnotation(ctx, description, spec.params);
                break;
        }
        description.push('---');
        description.push(`- **View kind:** ${spec.kind}`);
        description.push(`- **View params:** ${JSON.stringify(spec.params, undefined, 1)}`);
        // TODO Molstar: ensure that camera transition is played when loading a multistate MVS! (or give up animations if not possible)
        if (asMultistate) {
            const snapshot = builder.getSnapshot({ title: spec.name, description: description.join('\n\n'), linger_duration_ms: 10_000 });
            return MVSData.createMultistate([snapshot], { title: spec.name, description: description.join('\n\n') });
        } else {
            return builder.getState({ title: spec.name, description: description.join('\n\n') });
        }
    }

    private async loadEntry(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['entry']) {
        const struct = ctx.model.modelStructure();
        struct.component().focus();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(struct, { modifiedResidues });
        const representations = applyStandardRepresentations(components, { opacityFactor: 1, skipComponents: ['water'] });

        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        for (const repr of Object.values(representations)) {
            applyEntityColors(repr, entityColors);
        }

        outDescription.push('## Deposited model');
    }

    private async loadAssembly(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['assembly']) {
        const assembliesInfo = await this.dataProvider.assemblies(params.entry);
        const assInfo = assembliesInfo.find(ass => ass.assemblyId === params.assemblyId);
        const struct = ctx.model.assemblyStructure({ assembly_id: params.assemblyId });
        struct.component().focus();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(struct, { modifiedResidues });
        const representations = applyStandardRepresentations(components, { opacityFactor: 1, skipComponents: ['water'] });

        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        for (const repr of Object.values(representations)) {
            applyEntityColors(repr, entityColors);
        }

        outDescription.push(`## Assembly ${params.assemblyId}`);
        outDescription.push(`This assembly is a ${assInfo?.form}-${assInfo?.name}.`);
        if (assInfo?.preferred) outDescription.push(`This is the preferred assembly.`);
    }

    private async loadEntity(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['entity']) {
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

        const struct = theAssembly !== undefined ? ctx.model.assemblyStructure({ assembly_id: theAssembly }) : ctx.model.modelStructure();
        struct.component().focus();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(struct, { modifiedResidues });

        const modelData = await this.modelProvider.getModel(params.entry);
        const bgOpacity = smartFadedOpacity(structurePolymerResidueCount(modelData, theAssembly));
        const representations = applyStandardRepresentations(components, { opacityFactor: bgOpacity, skipComponents: ['water'] });

        for (const repr of Object.values(representations)) {
            repr.color({ color: 'gray' });
        }

        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        const entityType = decideEntityType(entities[params.entityId]);

        const entityComponents = applyStandardComponentsForEntity(struct, params.entityId, entityType, { modifiedResidues });
        const entityRepresentations = applyStandardRepresentations(entityComponents, { opacityFactor: 1 });
        for (const repr of Object.values(entityRepresentations)) {
            repr.color({ color: entityColors[params.entityId] });
        }

        outDescription.push(`## Entity ${params.entityId}`);
        const entityName = entities[params.entityId].name;
        outDescription.push((entityName ? `__${entityName}__` : '*Entity name not available*') + ` (${entityType})`);
        if (theAssembly === preferredAssembly) {
            outDescription.push(`Showing in assembly ${theAssembly} (preferred).`);
        } else if (theAssembly !== undefined) {
            outDescription.push(`Showing in assembly ${theAssembly}.`);
        } else {
            outDescription.push(`Showing in the deposited model.`);
        }
    }

    private async loadDomain(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['domain']) {
        const struct = ctx.model.modelStructure();

        const coverages = await this.dataProvider.authChainCoverages(params.entry);
        const domainInfo = await this.dataProvider.siftsMappingsByEntity(params.entry);
        const domainColors = getDomainColors(domainInfo); // TODO cache? (incl. many things that need to be computed just once, e.g. getChainInfo)

        const domainsInEntity = domainInfo[params.source][params.familyId][params.entityId];
        const shownAuthChain = max(domainsInEntity.map(dom => dom.chunks[0].authChainId), chain => coverages[chain]);
        const domainsInChain = domainsInEntity.filter(dom => dom.chunks[0].authChainId === shownAuthChain);
        struct.component({ selector: { auth_asym_id: shownAuthChain } }).focus();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);

        const modelData = await this.modelProvider.getModel(params.entry);
        const chainInfo = getChainInfo(modelData);
        const chainsToShow = Object.keys(chainInfo).filter(c => chainInfo[c].authChainId === shownAuthChain);
        const entitiesInfo = await this.dataProvider.entities(params.entry);
        const shownPolymerLabelChain = Object.keys(chainInfo).find(c => chainInfo[c].authChainId === shownAuthChain && decideEntityType(entitiesInfo[chainInfo[c].entityId]) === 'polymer');
        const components = applyStandardComponentsForChains(struct, chainsToShow, chainInfo, entitiesInfo, { modifiedResidues });
        const representations = applyStandardRepresentations(components, { opacityFactor: FADED_OPACITY, skipComponents: ['water'] })
        for (const repr of Object.values(representations)) {
            repr.color({ color: 'gray' });
        }
        for (const domain of domainsInChain) {
            const domainComp = struct.component({ selector: domain.chunks.map(chunk => ({ label_asym_id: chunk.chainId, beg_label_seq_id: chunk.startResidue, end_label_seq_id: chunk.endResidue })) });
            const modresInDomain = modifiedResidues.filter(r => r.labelAsymId === domain.chunks[0].chainId && domain.chunks.some(dom => (dom.startResidue ?? Infinity) <= r.labelSeqId && r.labelSeqId <= (dom.endResidue ?? -Infinity)));
            const modresComp = struct.component({ selector: modresInDomain.map(r => ({ label_asym_id: r.labelAsymId, label_seq_id: r.labelSeqId })) });
            const color = (domainColors[domain.id] ?? ANNOTATION_COLORS[0]);
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

    private async loadLigand(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['ligand']) {
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

        const struct = ctx.model.modelStructure();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(struct, { modifiedResidues });

        const modelData = await this.modelProvider.getModel(params.entry);
        const bgOpacity = smartFadedOpacity(structurePolymerResidueCount(modelData, undefined));
        const representations = applyStandardRepresentations(components, { opacityFactor: bgOpacity, skipComponents: ['water'] });

        for (const repr of Object.values(representations)) {
            repr.color({ color: 'gray' });
        }
        const ligandComp = struct.component({ selector: { label_asym_id: labelAsymId } });

        const entityColors = getEntityColors(entities);
        const ligandRepr = ligandComp.representation({ type: 'ball_and_stick' }).color({ color: entityColors[entityRecord.id] });
        applyElementColors(ligandRepr);

        const LIGAND_ENVIRONMENT_RADIUS = 5;
        const environmentSelector = chainSurroundings(modelData, labelAsymId, LIGAND_ENVIRONMENT_RADIUS);
        const environmentComp = struct.component({ selector: environmentSelector });
        const environmentRepr = environmentComp.representation({ type: 'ball_and_stick', size_factor: 0.5 }).color({ color: 'gray' });
        applyElementColors(environmentRepr);
        environmentComp.focus();

        const chainInfo = getChainInfo(modelData);
        const authAsymId = chainInfo[labelAsymId].authChainId;

        outDescription.push(`## Ligand ${params.compId}`);
        outDescription.push(`Showing ligand **${entityRecord.name}** (${params.compId}) in chain ${labelAsymId} [auth ${authAsymId}] in the deposited model.`);
    }

    private async loadModres(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['modres']) {
        const assembliesInfo = await this.dataProvider.assemblies(params.entry);
        const preferredAssembly = assembliesInfo.find(ass => ass.preferred)?.assemblyId; // preferred assembly

        const struct = preferredAssembly !== undefined ? ctx.model.assemblyStructure({ assembly_id: preferredAssembly }) : ctx.model.modelStructure();
        struct.component().focus();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(struct, { modifiedResidues });

        const modelData = await this.modelProvider.getModel(params.entry);
        const bgOpacity = smartFadedOpacity(structurePolymerResidueCount(modelData, preferredAssembly));
        const representations = applyStandardRepresentations(components, { opacityFactor: bgOpacity, skipComponents: ['water'] });

        for (const repr of Object.values(representations)) {
            repr.color({ color: 'gray' });
        }

        const modresComp = struct.component({
            selector: modifiedResidues.filter(r => r.compoundId === params.compId).map(r => ({ label_asym_id: r.labelAsymId, label_seq_id: r.labelSeqId })),
        });
        const modresRepr = modresComp.representation({ type: 'ball_and_stick' });
        const modresColors = getModresColors(modifiedResidues);
        modresRepr.color({ color: modresColors[params.compId] ?? MODRES_COLORS[0] });

        const modresName = modifiedResidues.find(r => r.compoundId === params.compId)?.compoundName;
        outDescription.push(`## Modified residue ${params.compId}`);
        outDescription.push(modresName ? `__${modresName}__` : '*Modified residue name not available*');
        if (preferredAssembly !== undefined) {
            outDescription.push(`Showing in assembly ${preferredAssembly} (preferred).`);
        } else {
            outDescription.push(`Showing in the deposited model.`);
        }
    }

    private async loadBfactor(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['bfactor']) {
        const struct = ctx.model.modelStructure();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(struct, { modifiedResidues });

        const representations = applyStandardRepresentations(components, { skipComponents: ['polymer', 'water'] });
        representations.polymerCartoon = components.polymer?.representation({ type: 'cartoon' }); // TODO Molstar: make this putty with size "uncertainty" (low prio)

        for (const repr of Object.values(representations)) {
            repr.colorFromSource({
                schema: 'all_atomic', category_name: 'atom_site', field_name: 'B_iso_or_equiv',
                palette: {
                    kind: 'continuous',
                    colors: 'Plasma',
                    value_domain: [0, 120], // TODO ask about reasonable cutoff for Bfactor
                    overflow_color: '#eff821', // last color from Plasma
                },
            });
        }
        struct.component().tooltip({ text: '<hr>B-factor:' });
        struct.tooltipFromSource({ schema: 'all_atomic', category_name: 'atom_site', field_name: 'B_iso_or_equiv' });

        outDescription.push(`## B-factor`);
        outDescription.push(`Showing B-factor for the deposited model, colored by Plasma color scheme (0 = blue, 120 = yellow). Values above 120 are clipped.`);
    }

    private async loadValidation(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['validation']) {
        const struct = ctx.model.modelStructure();

        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(struct, { modifiedResidues });
        const representations = applyStandardRepresentations(components, { skipComponents: ['water'] });

        const annotationHeader = `data:text/plain,
        data_annotations
        loop_
        _annot.label_asym_id
        _annot.label_seq_id
        _annot.class
        _annot.tooltip
        . . 0 'OK'
        `;
        const annotationRows: string[] = [];

        const validationReport = await this.dataProvider.pdbeStructureQualityReport(params.entry);
        if (validationReport !== undefined) {
            for (const molecule of validationReport.molecules) {
                for (const chain of molecule.chains) {
                    for (const residue of chain.models[0].residues) {
                        const class_ = params.validation_type === 'issue_count' ? Math.min(residue.outlier_types.length, 3) : residue.outlier_types.includes(params.validation_type) ? 'y' : undefined;
                        if (class_) {
                            annotationRows.push(`${chain.struct_asym_id} ${residue.residue_number} ${class_} '${residue.outlier_types.join(', ')}'`);
                        }
                    }
                }
            }
            const annotationUri = annotationHeader + annotationRows.join(' ');
            for (const repr of Object.values(representations)) {
                repr.color({ color: VALIDATION_COLORS[0] }); // base color for residues without issues (not listed in the report)
            }
            representations.polymerCartoon?.colorFromUri({
                uri: annotationUri, format: 'cif', schema: 'all_atomic', category_name: 'annot', field_name: 'class',
                palette: { kind: 'categorical', colors: { '0': VALIDATION_COLORS[0], '1': VALIDATION_COLORS[1], '2': VALIDATION_COLORS[2], '3': VALIDATION_COLORS[3], 'y': VALIDATION_COLORS.HAS_ISSUE } },
            });
            struct.component().tooltip({ text: '<hr>Validation:' });
            struct.tooltipFromUri({ uri: annotationUri, format: 'cif', schema: 'all_atomic', category_name: 'annot', field_name: 'tooltip' });
            outDescription.push(`## Validation`);
            if (params.validation_type === 'issue_count') {
                outDescription.push(`**PDBe Structure Quality Report:** Residues are coloured by the number of geometry validation issue types. White - no issues, yellow - one issue type, orange - two issue types, red - three or more issue types.`);
            } else {
                outDescription.push(`**PDBe Structure Quality Report:** Residues are coloured by presence of "${params.validation_type}" validation issues. White - no issue, red - has issues.`);
            }
        } else {
            for (const repr of Object.values(representations)) {
                repr.color({ color: VALIDATION_COLORS.NOT_APPLICABLE });
            }
            struct.component().tooltip({ text: '<hr>Validation: Not available' });
            outDescription.push(`## Validation`);
            outDescription.push(`PDBe Structure Quality Report not available for this entry.`);
        }
    }

    private async _loadPdbconnectBase(ctx: BuilderContext, params: { entry: string, assemblyId: string, ensureEntity?: string, ensureChain?: string }) {
        let displayedAssembly = params.assemblyId === PREFERRED ?
            getPreferredAssembly(await this.dataProvider.assemblies(params.entry)).assemblyId
            : params.assemblyId;

        if (displayedAssembly !== MODEL && params.ensureEntity !== undefined) {
            const entities = await this.dataProvider.entities(params.entry); // TODO retrieve from model if we already have it
            const entityChains = entities[params.ensureEntity].chains;
            const modelData = await this.modelProvider.getModel(params.entry);
            const chainInstancesInfo = getChainInstancesInAssemblies(modelData);
            // Find out if the assembly contains this entity and potentially fall back to deposited model)
            const entityPresent = entityChains.some(chain => chainInstancesInfo[displayedAssembly].operatorsPerChain[chain]?.length > 0);
            if (!entityPresent) {
                displayedAssembly = MODEL;
            }
        }

        if (displayedAssembly !== MODEL && params.ensureChain !== undefined) {
            const modelData = await this.modelProvider.getModel(params.entry);
            const chainInstancesInfo = getChainInstancesInAssemblies(modelData);
            // Find out if the assembly contains this chain entity and potentially fall back to deposited model)
            const chainsPresent = chainInstancesInfo[displayedAssembly].operatorsPerChain[params.ensureChain]?.length > 0;
            if (!chainsPresent) {
                displayedAssembly = MODEL;
            }
        }

        const structure = displayedAssembly === MODEL ? ctx.model.modelStructure() : ctx.model.assemblyStructure({ assembly_id: displayedAssembly });
        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const components = applyStandardComponents(structure, { modifiedResidues });
        const representations = applyStandardRepresentations(components, { opacityFactor: 1 });
        // TODO Molstar: ball_and_stick size theme physical?
        // TODO compute PCA to orient camera?

        return {
            ...ctx,
            structure,
            components,
            representations,
            metadata: { displayedAssembly, modifiedResidues },
        };
    }

    private async loadPdbconnectSummaryDefault(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['pdbconnect_summary_default'] & { ensureEntity?: string, ensureChain?: string }) {
        const base = await this._loadPdbconnectBase(ctx, params);
        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        for (const repr of Object.values(base.representations)) {
            applyEntityColors(repr, entityColors);
        }
        for (const repr of atomicRepresentations(base.representations)) {
            applyElementColors(repr);
        }
        // TODO ensure default Molstar show-environment behavior uses either entity colors or all-gray -> PDBeMolstar does it somehow but now idea how (+ ideally increase bubble size)

        if (params.assemblyId === PREFERRED) {
            outDescription.push(`## Preferred complex`);
        } else {
            outDescription.push(`## Complex ${base.metadata.displayedAssembly}`);
        }
        outDescription.push(`This is complex (assembly) ${base.metadata.displayedAssembly}.`);
        return {
            ...base,
            metadata: {
                ...base.metadata,
                entities,
                entityColors,
            }
        };
    }

    private async loadPdbconnectSummaryMacromolecule(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['pdbconnect_summary_macromolecule']) {
        const base = await this._loadPdbconnectBase(ctx, { entry: params.entry, assemblyId: params.assemblyId, ensureEntity: params.entityId });
        const { displayedAssembly } = base.metadata;

        // const modelData = await this.modelProvider.getModel(params.entry);
        // const bgOpacity = smartFadedOpacity(structurePolymerResidueCount(modelData, base.metadata.displayedAssembly));
        // for (const repr of Object.values(base.representations)) {
        //     repr.color({ color: 'gray' }).opacity({ opacity:bgOpacity });
        // }

        const entities = await this.dataProvider.entities(params.entry); // TODO retrieve from model if we already have it?
        const entityColors = getEntityColors(entities);

        for (const repr of Object.values(base.representations)) {
            applyEntityColors(repr, { [params.entityId]: entityColors[params.entityId] });
        }
        // TODO Molstar: coloring by element within selection (entity)
        // for (const repr of atomicRepresentations(base.representations)) {
        //     applyElementColors(repr);
        // }
        base.structure.component({ selector: { label_entity_id: params.entityId } }).focus();

        // const entityType = decideEntityType(entities[params.entityId]);
        // const entityComponents = applyStandardComponentsForChain(base.structure, params.labelAsymId, params.instanceId, entityType, { modifiedResidues });
        // for (const comp of Object.values(entityComponents)) {
        //     comp.focus();
        // }
        // const entityRepresentations = applyStandardRepresentations(entityComponents, { opacityFactor: 1, sizeFactor: 1.05, custom: CustomDataForEmissivePulse, refPrefix: 'highlighted' });
        // for (const repr of Object.values(entityRepresentations)) {
        //     repr.color({ color: entityColors[params.entityId] });
        // }
        // for (const repr of atomicRepresentations(entityRepresentations)) {
        //     applyElementColors(repr);
        // }
        // base.root.animation({})
        //     .interpolate(makeEmissivePulse('highlighted_polymerCartoon'))
        //     .interpolate(makeEmissivePulse('highlighted_nonstandardSticks'));
        // TODO Molstar: fix focusing on polymer + nonstandard (empty) in 1hda

        outDescription.push(`## Macromolecule ${params.entityId}`);
        const assemblyText = displayedAssembly === MODEL ? 'the deposited model' : `complex (assembly) ${displayedAssembly}`;
        outDescription.push(`This is macromolecule ${params.entityId} **${entities[params.entityId].name}** in chain ${params.labelAsymId} (label_asym_id) in ${assemblyText}.`);
        if (displayedAssembly === MODEL && params.assemblyId !== MODEL) {
            outDescription.push(`*\u26A0 Entity ${params.entityId} is not present in the requested assembly (${params.assemblyId}), displaying the deposited model instead.*`);
        }
    }

    private async loadPdbconnectSummaryAllLigands(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['pdbconnect_summary_all_ligands']) {
        const base = await this._loadPdbconnectBase(ctx, { entry: params.entry, assemblyId: params.assemblyId });
        const { displayedAssembly } = base.metadata;

        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        for (const entityId in entities) {
            const entity = entities[entityId];
            const entityColor = entityColors[entityId];
            if (entityIsLigand(entity)) {
                base.structure
                    .component({ selector: { label_entity_id: entity.id } })
                    .representation({ type: 'spacefill' })
                    .color({ color: entityColor });
            }
        }

        outDescription.push(`## All ligands`);
        const assemblyText = displayedAssembly === MODEL ? 'the deposited model' : `complex (assembly) ${displayedAssembly}`;
        outDescription.push(`Overview of all ligands in ${assemblyText}.`);
    }

    private async loadPdbconnectSummaryLigand(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['pdbconnect_summary_ligand']) {
        const base = await this.loadPdbconnectSummaryDefault(ctx, [], { entry: params.entry, assemblyId: params.assemblyId, ensureChain: params.labelAsymId });
        const { displayedAssembly, entities } = base.metadata;

        base.structure
            .component({ selector: { label_asym_id: params.labelAsymId, instance_id: params.instanceId } })
            .focus({ radius_factor: FOCUS_RADIUS_FACTOR, radius_extent: FOCUS_RADIUS_EXTENT });

        outDescription.push(`## Ligand entity ${params.entityId}`);
        const assemblyText = displayedAssembly === MODEL ? 'the deposited model' : `complex (assembly) ${displayedAssembly}`;
        outDescription.push(`This is ligand entity ${params.entityId} **${entities[params.entityId].compIds[0]}** in chain ${params.labelAsymId} (label_asym_id) in ${assemblyText}.`);
        if (displayedAssembly === MODEL && params.assemblyId !== MODEL) {
            outDescription.push(`*\u26A0 Entity ${params.entityId} is not present in the requested assembly (${params.assemblyId}), displaying the deposited model instead.*`);
        }
    }

    private async loadPdbconnectSummaryDomainsDefault(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['pdbconnect_summary_domains_default']) {
        const base = await this._loadPdbconnectBase(ctx, params);
        const { displayedAssembly } = base.metadata;
        outDescription.push(`## Domains - default view`);
        const assemblyText = displayedAssembly === MODEL ? 'the deposited model' : `complex (assembly) ${displayedAssembly}`;
        outDescription.push(`Showing ${assemblyText} (nothing highlighted here, select domain source or specific domain to see highlights).`);
    }

    private async loadPdbconnectSummaryDomainsInSource(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['pdbconnect_summary_domains_in_source']) {
        const domainInfo = await this.dataProvider.siftsMappingsByEntity(params.entry);
        const domainFamilyColors = getDomainFamilyColors(domainInfo); // TODO cache? (incl. many things that need to be computed just once, e.g. getChainInfo)

        const base = await this._loadPdbconnectBase(ctx, params);
        const { displayedAssembly } = base.metadata;

        const srcDomains = domainInfo[params.source];
        for (const familyId in srcDomains) {
            const famDomains = srcDomains[familyId];
            const color = domainFamilyColors[familyId];
            for (const entityId in famDomains) {
                const entDomains = famDomains[entityId];
                for (const domain of entDomains) {
                    const selector: ComponentExpressionT[] = domain.chunks.map(
                        chunk => ({ label_asym_id: chunk.chainId, beg_label_seq_id: chunk.startResidue, end_label_seq_id: chunk.endResidue })
                    );
                    base.representations.polymerCartoon?.color({ selector, color });
                    base.representations.nonstandardSticks?.color({ selector, color });
                }
            }
        }

        outDescription.push(`## Domains in ${params.source}`);
        const assemblyText = displayedAssembly === MODEL ? 'the deposited model' : `complex (assembly) ${displayedAssembly}`;
        outDescription.push(`Showing all domains from source ${params.source} in ${assemblyText}.`);
    }

    private async loadPdbconnectSummaryDomain(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['pdbconnect_summary_domain']) {
        // TODO color ligands by element (a la PDBconnect Domain tab)
        const domainInfo = await this.dataProvider.siftsMappingsByEntity(params.entry);
        const domainFamilyColors = getDomainFamilyColors(domainInfo);
        const domain = domainInfo[params.source][params.familyId][params.entityId].find(dom => dom.id === params.domainId);
        const labelAsymId = domain?.chunks[0].chainId;

        const base = await this._loadPdbconnectBase(ctx, { entry: params.entry, assemblyId: params.assemblyId, ensureChain: labelAsymId });
        const { displayedAssembly } = base.metadata;

        if (domain) {
            const color = domainFamilyColors[domain.family];
            const selector: ComponentExpressionT[] = domain.chunks.map(
                chunk => ({ label_asym_id: chunk.chainId, beg_label_seq_id: chunk.startResidue, end_label_seq_id: chunk.endResidue, instance_id: params.instanceId })
            );
            base.representations.polymerCartoon?.color({ selector, color });
            base.representations.nonstandardSticks?.color({ selector, color });
            base.structure.component({ selector }).focus();
        }

        outDescription.push(`## Domain ${params.domainId}`);
        const assemblyText = displayedAssembly === MODEL ? 'the deposited model' : `complex (assembly) ${displayedAssembly}`;
        outDescription.push(`Showing ${params.source} ${params.familyId} domain ${params.domainId} in ${assemblyText}.`);
    }

    private async loadPdbconnectSummaryAllModifications(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['pdbconnect_summary_all_modifications']) {
        const base = await this._loadPdbconnectBase(ctx, { entry: params.entry, assemblyId: params.assemblyId });
        const { displayedAssembly } = base.metadata;

        if (base.components.nonstandard) {
            const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
            const modresColors = getModresColors(modifiedResidues);
            const modresSpacefill = base.components.nonstandard.representation({ type: 'spacefill' });
            for (const compId in modresColors) {
                modresSpacefill.color({ selector: { label_comp_id: compId }, color: modresColors[compId] });
            }
        }

        outDescription.push(`## All modified residues`);
        const assemblyText = displayedAssembly === MODEL ? 'the deposited model' : `complex (assembly) ${displayedAssembly}`;
        outDescription.push(`Overview of all modified residues in ${assemblyText}.`);
    }

    private async loadPdbconnectSummaryModification(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['pdbconnect_summary_modification']) {
        const base = await this._loadPdbconnectBase(ctx, { entry: params.entry, assemblyId: params.assemblyId, ensureChain: params.labelAsymId });
        const { displayedAssembly } = base.metadata;
        const entities = await this.dataProvider.entities(params.entry);
        const entityColors = getEntityColors(entities);
        const modifiedResidues = await this.dataProvider.modifiedResidues(params.entry);
        const modresColors = getModresColors(modifiedResidues);
        for (const [reprName, repr] of Object.entries(base.representations)) {
            if (reprName as StandardRepresentationType === 'nonstandardSticks') {
                for (const compId in modresColors) {
                    repr.color({ selector: { label_comp_id: compId }, color: modresColors[compId] });
                }
            } else {
                applyEntityColors(repr, entityColors);
            }
        }
        for (const repr of atomicRepresentations(base.representations)) {
            applyElementColors(repr);
        }
        base.structure
            .component({ selector: { label_asym_id: params.labelAsymId, label_seq_id: params.labelSeqId, instance_id: params.instanceId } })
            .focus({ radius_factor: FOCUS_RADIUS_FACTOR, radius_extent: FOCUS_RADIUS_EXTENT });

        outDescription.push(`## Modified residue ${params.compId}`);
        const assemblyText = displayedAssembly === MODEL ? 'the deposited model' : `complex (assembly) ${displayedAssembly}`;
        outDescription.push(`This is modified residue **${params.compId}** ${params.labelSeqId} (label_seq_id) in chain ${params.labelAsymId} (label_asym_id) in ${assemblyText}.`);
        if (displayedAssembly === MODEL && params.assemblyId !== MODEL) {
            outDescription.push(`*\u26A0 Chain ${params.labelAsymId} (label_asym_id) is not present in the requested assembly (${params.assemblyId}), displaying the deposited model instead.*`);
        }
    }

    private async loadPdbconnectQuality(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['pdbconnect_quality']) {
        const base = await this._loadPdbconnectBase(ctx, { entry: params.entry, assemblyId: params.assemblyId });
        const { displayedAssembly } = base.metadata;
        const assemblyText = displayedAssembly === MODEL ? 'the deposited model' : `complex (assembly) ${displayedAssembly}`;

        const validationReport = await this.dataProvider.pdbeStructureQualityReport(params.entry);
        if (validationReport !== undefined) {
            const annotationCif = [
                'data_validation',
                'loop_',
                '_validation.label_asym_id',
                '_validation.label_seq_id',
                '_validation.class',
                '_validation.tooltip',
                '. . 0 OK',
            ];
            for (const molecule of validationReport.molecules) {
                for (const chain of molecule.chains) {
                    for (const residue of chain.models[0].residues) {
                        const class_ = params.validation_type === 'issue_count' ? Math.min(residue.outlier_types.length, 3) : residue.outlier_types.includes(params.validation_type) ? 'y' : undefined;
                        if (class_) {
                            annotationCif.push(`${chain.struct_asym_id} ${residue.residue_number} ${class_} '${residue.outlier_types.join(', ')}'`);
                        }
                    }
                }
            }
            const annotationUri = 'data:text/plain, ' + annotationCif.join(' ');
            for (const repr of Object.values(base.representations)) {
                repr.color({ color: VALIDATION_COLORS[0] }); // base color for residues without issues (not listed in the report)
            }
            base.representations.polymerCartoon?.colorFromUri({
                uri: annotationUri, format: 'cif', schema: 'all_atomic', category_name: 'validation', field_name: 'class',
                palette: { kind: 'categorical', colors: { '0': VALIDATION_COLORS[0], '1': VALIDATION_COLORS[1], '2': VALIDATION_COLORS[2], '3': VALIDATION_COLORS[3], 'y': VALIDATION_COLORS.HAS_ISSUE } },
            });
            base.structure.component().tooltip({ text: '<hr>Validation:' });
            base.structure.tooltipFromUri({ uri: annotationUri, format: 'cif', schema: 'all_atomic', category_name: 'validation', field_name: 'tooltip' });
            outDescription.push(`## Validation`);
            if (params.validation_type === 'issue_count') {
                outDescription.push(`**PDBe Structure Quality Report:** Residues are coloured by the number of geometry validation issue types. White - no issues, yellow - one issue type, orange - two issue types, red - three or more issue types.`);
            } else {
                outDescription.push(`**PDBe Structure Quality Report:** Residues are coloured by presence of "${params.validation_type}" validation issues. White - no issue, red - has issues.`);
            }
            outDescription.push(`Displaying ${assemblyText}.`);
        } else {
            for (const repr of Object.values(base.representations)) {
                repr.color({ color: VALIDATION_COLORS.NOT_APPLICABLE });
            }
            base.structure.component().tooltip({ text: '<hr>Validation: Not available' });
            outDescription.push(`## Validation`);
            outDescription.push(`PDBe Structure Quality Report not available for this entry.`);
            outDescription.push(`Displaying ${assemblyText}.`);
        }
    }

    private async loadPdbconnectEnvironment(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['pdbconnect_environment']) {
        const base = await this.loadPdbconnectSummaryDefault(ctx, [], { entry: params.entry, assemblyId: params.assemblyId, ensureChain: params.labelAsymId });
        const { displayedAssembly, entityColors } = base.metadata;

        base.structure
            .component({
                selector: { auth_asym_id: params.authAsymId, auth_seq_id: params.authSeqId, pdbx_PDB_ins_code: params.authInsCode, instance_id: params.instanceId },
                custom: { molstar_show_non_covalent_interactions: params.atomInteractions === 'builtin' },
            })
            .focus({ radius_factor: FOCUS_RADIUS_FACTOR, radius_extent: FOCUS_RADIUS_EXTENT });

        if (params.atomInteractions === 'api') {
            const atomInteractions = await this.dataProvider.atomInteractions(params.entry, params.authAsymId, params.authSeqId);
            const partnerResidues: { auth_asym_id: string, auth_seq_id: number, pdbx_PDB_ins_code?: string, instance_id?: string }[] = [];
            const primitives = base.structure.primitives();
            for (const { interactions, ligand } of atomInteractions) {
                for (const int of interactions) {
                    const details = int.interaction_details;
                    const color = details.length === 1 ? (ATOM_INTERACTION_COLORS[details[0]] ?? ATOM_INTERACTION_COLORS._DEFAULT_) : ATOM_INTERACTION_COLORS._MIXED_;
                    // TODO pass colors from frontend (also for entities, domains etc)
                    const formatInteractionType = (type: string) => INTERACTION_NICE_NAMES[type] ?? type;
                    const tooltipHeader = details.length === 1 ?
                        `<strong>${formatInteractionType(details[0])} interaction</strong>`
                        : `<strong>Mixed interaction</strong><br>${details.map(formatInteractionType).join(', ')}`;
                    const tooltipLigand = `<strong>${ligand.chem_comp_id} ${ligand.author_residue_number}${ligand.author_insertion_code?.trim() ?? ''}</strong> | ${int.ligand_atoms.join(', ')}`;
                    const tooltipPartner = `<strong>${int.end.chem_comp_id} ${int.end.author_residue_number}${int.end.author_insertion_code?.trim() ?? ''}</strong> | ${int.end.atom_names.join(', ')}`;
                    const tooltip = `${tooltipHeader}<br>${tooltipLigand} — ${tooltipPartner}`;
                    const ligandSelector: ComponentExpressionT[] = int.ligand_atoms.map(atom => ({
                        auth_asym_id: ligand.chain_id,
                        auth_seq_id: ligand.author_residue_number,
                        pdbx_PDB_ins_code: normalizeInsertionCode(ligand.author_insertion_code),
                        auth_atom_id: atom,
                        instance_id: params.instanceId,
                    }));
                    const partnerSelector: ComponentExpressionT[] = int.end.atom_names.map(atom => ({
                        auth_asym_id: int.end.chain_id,
                        auth_seq_id: int.end.author_residue_number,
                        pdbx_PDB_ins_code: normalizeInsertionCode(int.end.author_insertion_code),
                        auth_atom_id: atom,
                        instance_id: params.instanceId,
                    }));
                    primitives.tube({
                        start: { expressions: ligandSelector },
                        end: { expressions: partnerSelector },
                        radius: INTERACTION_TUBE_RADIUS,
                        dash_length: INTERACTION_TUBE_DASH_LENGTH,
                        color: color,
                        tooltip: tooltip,
                    });
                    partnerResidues.push({
                        auth_asym_id: int.end.chain_id,
                        auth_seq_id: int.end.author_residue_number,
                        pdbx_PDB_ins_code: normalizeInsertionCode(int.end.author_insertion_code),
                        instance_id: params.instanceId,
                    });
                }
            }
            const partnerResiduesRepr = base.structure
                .component({ selector: unique(partnerResidues, r => `${r.auth_asym_id}:${r.auth_seq_id}:${r.pdbx_PDB_ins_code ?? ''}:${r.instance_id ?? ''}`) })
                .representation({ type: 'ball_and_stick', size_factor: 0.5 });
            applyEntityColors(partnerResiduesRepr, entityColors);
            applyElementColors(partnerResiduesRepr);
        }
        // TODO volumes

        outDescription.push(`## Residue environment for auth ${params.authAsymId} ${params.authSeqId}${params.authInsCode} `);
        const assemblyText = displayedAssembly === MODEL ? 'the deposited model' : `complex(assembly) ${displayedAssembly} `;
        outDescription.push(`This is residue auth ${params.authSeqId}${params.authInsCode} in chain auth ${params.authAsymId} in ${assemblyText}.`);
        if (displayedAssembly === MODEL && params.assemblyId !== MODEL) {
            outDescription.push(`*\u26A0 Residue is not present in the requested assembly(${params.assemblyId}), displaying the deposited model instead.* `);
        }
    }

    private async loadPdbconnectTextAnnotation(ctx: BuilderContext, outDescription: string[], params: SnapshotSpecParams['pdbconnect_text_annotation']) {
        const base = await this._loadPdbconnectBase(ctx, { entry: params.entry, assemblyId: params.assemblyId, ensureChain: params.labelAsymId });
        const { displayedAssembly } = base.metadata;

        const chainSelector: ComponentExpressionT = { label_asym_id: params.labelAsymId, instance_id: params.instanceId };
        const residueSelector: ComponentExpressionT = { ...chainSelector, label_seq_id: params.labelSeqId };

        const chainHighlightColor = CHAIN_ANNOTATED_COLOR;
        base.representations.polymerCartoon?.color({ selector: chainSelector, color: chainHighlightColor });
        base.representations.nonstandardSticks?.color({ selector: chainSelector, color: chainHighlightColor });

        const annots = await this.dataProvider.llmAnnotations(params.entry);
        const chainAnnots = annots[params.entityId][params.labelAsymId];
        const annotResiduesSelector: ComponentExpressionT[] = Object.keys(chainAnnots).map(labelSeqId => ({ ...chainSelector, label_seq_id: Number(labelSeqId) }));
        base.representations.polymerCartoon?.color({ selector: annotResiduesSelector, color: RESIDUE_ANNOTATED_COLOR });
        base.representations.nonstandardSticks?.color({ selector: annotResiduesSelector, color: RESIDUE_ANNOTATED_COLOR });
        for (const labelSeqId in chainAnnots) {
            const nAnnots = chainAnnots[labelSeqId].length;
            const bestScore = max(chainAnnots[labelSeqId].map(a => a.aiScore));
            const flooredBestScore = Math.floor(bestScore * 100) / 100;
            base.structure
                .component({ selector: { ...chainSelector, label_seq_id: Number(labelSeqId) } })
                .tooltip({ text: `<hr>${nAnnots} annotation${nAnnots === 1 ? '' : 's'}, ${nAnnots === 1 ? '' : 'best '} AI score ${flooredBestScore.toFixed(2)}` });
        }

        if (params.labelSeqId !== undefined) {
            base.representations.polymerCartoon?.color({ selector: residueSelector, color: RESIDUE_HIGHLIGHT_COLOR });
            base.representations.nonstandardSticks?.color({ selector: residueSelector, color: RESIDUE_HIGHLIGHT_COLOR });
            const residueSticks = base.structure
                .component({ selector: residueSelector })
                .representation({ type: 'ball_and_stick', size_factor: 1.05 })
                .color({ color: RESIDUE_HIGHLIGHT_COLOR });
            applyElementColors(residueSticks);
            base.structure.component({ selector: residueSelector, custom: { molstar_show_non_covalent_interactions: true } });
        }

        for (const repr of atomicRepresentations(base.representations)) {
            applyElementColors(repr);
        }
        base.structure.component({ selector: residueSelector }).focus({ radius_factor: FOCUS_RADIUS_FACTOR, radius_extent: FOCUS_RADIUS_EXTENT });
        // TODO volumes

        const assemblyText = displayedAssembly === MODEL ? 'the deposited model' : `complex (assembly) ${displayedAssembly}`;
        if (params.labelSeqId !== undefined) {
            outDescription.push(`## Text annotations in chain ${params.labelAsymId} residue ${params.labelSeqId}`);
            outDescription.push(`Showing chain ${params.labelAsymId} (label_asym_id) residue ${params.labelSeqId} (label_seq_id) in ${assemblyText}.`);
        } else {
            outDescription.push(`## Text annotations in chain ${params.labelAsymId}`);
            outDescription.push(`Showing chain ${params.labelAsymId} (label_asym_id) in ${assemblyText}.`);
        }
    }
}


const CustomDataForEmissivePulse = { molstar_representation_params: { emissive: 0 } };
function makeEmissivePulse(representationRef: string, strength: number = 0.33): MVSAnimationNodeParams<"interpolate"> {
    return {
        kind: 'scalar' as const,
        target_ref: representationRef,
        start_ms: 250, // TODO ensure this happen in the middle of camera transition
        duration_ms: 600,
        frequency: 2, // TODO ask people if they like single of double blink
        alternate_direction: true,
        property: ['custom', 'molstar_representation_params', 'emissive'],
        start: 0,
        end: strength,
    };
}

export interface MVSSnapshotProviderConfig {
    PdbApiUrlPrefix: string,
    PdbStructureUrlTemplate: string,
    PdbStructureFormat: 'bcif' | 'mmcif' | 'pdb',
}

export const DefaultMVSSnapshotProviderConfig = {
    PdbApiUrlPrefix: 'https://www.ebi.ac.uk/pdbe/api/v2/',
    /** URL template for PDB structural data, '{pdb}' will be replaced by actual PDB ID. */
    PdbStructureUrlTemplate: 'https://www.ebi.ac.uk/pdbe/entry-files/{pdb}.bcif',
    /** Format for PDB structural data. */
    PdbStructureFormat: 'bcif',
} satisfies MVSSnapshotProviderConfig;


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
- Validation
  + We will have multiple validation metrics
  + Sameer: use white instead of green, check color code for colorblindness
- Sugar SNFG color - keep as is (by-chain / by-entity), for the future potentially add option to use SNFG colors

- Prefer sticks over balls

Current PDBconnect states (Nov2025):
- Summary - Preferred complex
- Summary - Macromolecule (per polymer entity, only highlights 1 instance)
- Summary - All ligands
- Summary - Highlight ligand (per ligand entity, only highlight 1 instance)
- Summary - Domains default (all white)
- Summary - Domains per database (CATH, Pfam, SCOP)
- Summary - Domain (per domain instance) (example 5cim)
- Summary - All modifications
- Summary - Modification (per modified residue type, all instances)
  - Ability to zoom individual instances
  - 3llc, MSE 1 in chain A - zooming currently fails (non-modelled residue)
- Model Quality - Issue count
- Model Quality - Specific issue (per issue type)
- Complexes - assembly (per assembly) -> same as Summary-Default
- Macromolecules - Highlight entity (per entity per chain, same as on Summary-Macromolecule?)
  - Ability to focus residues and show their interactions
    - Is this implemented via PDBeMolstar focus or something custom
- Ligand and Environments - Ligand interactions (per ligand instance)
  - Includes modified residues (TODO what about mon_nstd_flag=.? e.g. LOV in 1gkt)
  - Shows API interactions for ligands, Molstar interactions for modres
  - Ability to focus and highlight individual interactions
  - Genevieve's suggestions: use Fog (gives better depth perception)
- Domains - Domain (per domain instance)
  - Colors don't match those on Summary tab - ask if intended -> yes
- Text Annotations - Highlight entity (example 5cxt)
  - Ability to focus residues and show their interactions
- Citations - none

(Summary tab - all shown on preferred assembly)
(Model Quality tab - all shown on model)
(Macromolecules tab - all shown on preferred assembly)
(Interactivity!!! Highlighting on hover in menu)

New states:
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


Weird cases:
- Ligand is not in preferred assembly:
  - 5ele: entity 6 (PENTAETHYLENE GLYCOL), entity 7 (2-acetamido-2-deoxy-beta-D-glucopyranose)
  - 7nys: entity 5 (CL) not in pref. assembly 2
- Assembly with multiple operator groups applied to different chains: 3d12 assembly 1
- Entity polymer type "other": 1ti9, 3ok2, 3ok4, 2mrx, 5dgf TODO decide how to show them in frontend
- Entity polymer type "peptide nucleic acid": 2kvj
- Entity polymer type "cyclic-pseudo-peptide": no real examples but we should future-proof
- Symmetry operators with multiple operations in preferred assembly: 1m4x (ASM-1-61...)
- Multiple domain instances in one chain: 2ww8, 1n26
- 1hcj - more types of modified residues GYS, ABA
- 1l7c - modified residues not in preferred assembly
- 2n4n - designed peptide (25res) with 4G6, 4FU, current API misses modified residues, current image generation shows no linkage on modified residues
- 1d9d - modified residues on DNA (U31, C31)

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
