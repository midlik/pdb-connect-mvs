import type { IDataProvider } from './data-provider';
import { entityIsLigand, entityIsMacromolecule, getPreferredAssembly, listEntityInstancesInAssembly, listEntityInstancesInModel, uniqueModresCompIds } from './helpers';
import type { IModelProvider } from './model-provider';
import { MODEL, PREFERRED, type SnapshotKind, SnapshotKinds, type SnapshotSpec, ValidationTypes } from './mvs-snapshot-types';
import { getChainInstancesInAssemblies } from './structure-info';


export class MVSSnapshotListProvider {
    constructor(
        public readonly dataProvider: IDataProvider,
        public readonly modelProvider: IModelProvider,
    ) { }

    listSnapshotKinds(): readonly SnapshotKind[] {
        return SnapshotKinds;
    }

    async listSnapshots(entryId: string, kind?: SnapshotKind): Promise<SnapshotSpec[]> {
        if (kind === undefined) return this.listAllSnapshots(entryId);
        const out: SnapshotSpec[] = [];
        switch (kind) {
            case 'entry': {
                out.push({ kind: 'entry', name: `Entry`, params: { entry: entryId } });
                break;
            }
            case 'assembly': {
                const assemblies = await this.dataProvider.assemblies(entryId);
                for (const ass of assemblies) {
                    out.push({ kind: 'assembly', name: `Assembly ${ass.assemblyId}`, params: { entry: entryId, assemblyId: ass.assemblyId } });
                }
                break;
            }
            case 'entity': {
                const entities = await this.dataProvider.entities(entryId);
                for (const ent in entities) {
                    if (entities[ent].type === 'water') continue;
                    out.push({ kind: 'entity', name: `Entity ${ent}`, params: { entry: entryId, entityId: ent, assemblyId: undefined } });
                }
                break;
            }
            case 'domain': {
                const domains = await this.dataProvider.siftsMappingsByEntity(entryId);
                for (const source in domains) {
                    const srcDomains = domains[source];
                    for (const familyId in srcDomains) {
                        const famDomains = srcDomains[familyId];
                        for (const entityId in famDomains) {
                            out.push({ kind: 'domain', name: `Domain ${source} ${familyId} in entity ${entityId}`, params: { entry: entryId, source, familyId, entityId } });
                        }
                    }
                }
                break;
            }
            case 'ligand': {
                const entities = await this.dataProvider.entities(entryId); // thank you switch for not letting me have the same var name again
                for (const ent in entities) {
                    const entityRecord = entities[ent];
                    if (entityIsLigand(entityRecord)) {
                        const compId = entityRecord.compIds[0];
                        out.push({ kind: 'ligand', name: `Ligand ${compId}`, params: { entry: entryId, compId, labelAsymId: undefined } });
                    }
                }
                break;
            }
            case 'modres': {
                const modifiedResidues = await this.dataProvider.modifiedResidues(entryId);
                for (const compId of uniqueModresCompIds(modifiedResidues)) {
                    out.push({ kind: 'modres', name: `Modified residue ${compId}`, params: { entry: entryId, compId } });
                }
                break;
            }
            case 'bfactor': {
                const experimentalMethods = await this.dataProvider.experimentalMethods(entryId);
                const isXray = experimentalMethods.some(method => method.toLowerCase().includes('diffraction'));
                if (isXray) {
                    out.push({ kind: 'bfactor', name: `B-factor`, params: { entry: entryId } });
                }
                break;
            }
            case 'validation': {
                for (const validationType of ValidationTypes) {
                    out.push({ kind: 'validation', name: `Validation (${validationType})`, params: { entry: entryId, validation_type: validationType } });
                }
                break;
            }
            case 'pdbconnect_summary_default': {
                const assemblies = await this.dataProvider.assemblies(entryId);
                const preferred = assemblies.find(ass => ass.preferred);
                if (preferred) {
                    out.push({ kind: 'pdbconnect_summary_default', name: `Preferred complex`, params: { entry: entryId, assemblyId: PREFERRED } });
                }
                for (const ass of assemblies) {
                    out.push({ kind: 'pdbconnect_summary_default', name: `Complex ${ass.assemblyId}`, params: { entry: entryId, assemblyId: ass.assemblyId } });
                }
                break;
            }
            case 'pdbconnect_summary_macromolecule': {
                const entities = await this.dataProvider.entities(entryId);
                const assemblies = await this.dataProvider.assemblies(entryId);
                const preferredAssembly = getPreferredAssembly(assemblies).assemblyId;
                const modelData = await this.modelProvider.getModel(entryId);
                const chainInstancesInfo = getChainInstancesInAssemblies(modelData);
                for (const entityId in entities) {
                    const entity = entities[entityId];
                    if (entityIsMacromolecule(entity)) {
                        // Model-agnostic version:
                        // for (const labelAsymId of entity.chains) {
                        //     out.push({
                        //         kind: 'pdbconnect_summary_macromolecule',
                        //         name: `Entity ${entityId} (label_asym_id ${labelAsymId})`,
                        //         params: { entry: entryId, assemblyId: PREFERRED, entityId: entityId, labelAsymId: labelAsymId, instanceId: undefined },
                        //     });
                        // }
                        let instances = listEntityInstancesInAssembly(entity, chainInstancesInfo[preferredAssembly]);
                        if (instances.length === 0) instances = listEntityInstancesInModel(entity);
                        for (const instance of instances) {
                            out.push({
                                kind: 'pdbconnect_summary_macromolecule',
                                name: `Entity ${entityId} (label_asym_id ${instance.labelAsymId}, ${instance.instanceId ? `instance_id ${instance.instanceId}` : 'model'})`,
                                params: { entry: entryId, assemblyId: PREFERRED, entityId: entityId, labelAsymId: instance.labelAsymId, instanceId: instance.instanceId }
                            });
                        }
                    }
                }
                break;
            }
            case 'pdbconnect_summary_all_ligands': {
                out.push({ kind: 'pdbconnect_summary_all_ligands', name: `All ligands`, params: { entry: entryId, assemblyId: PREFERRED } });
                break;
            }
            case 'pdbconnect_summary_ligand': {
                const entities = await this.dataProvider.entities(entryId);
                const assemblies = await this.dataProvider.assemblies(entryId);
                const preferredAssembly = getPreferredAssembly(assemblies).assemblyId;
                const modelData = await this.modelProvider.getModel(entryId);
                const chainInstancesInfo = getChainInstancesInAssemblies(modelData);
                for (const entityId in entities) {
                    const entity = entities[entityId];
                    if (entityIsLigand(entity)) {
                        const compId = entity.compIds[0];
                        let instances = listEntityInstancesInAssembly(entity, chainInstancesInfo[preferredAssembly]);
                        if (instances.length === 0) instances = listEntityInstancesInModel(entity);
                        for (const instance of instances) {
                            out.push({
                                kind: 'pdbconnect_summary_ligand',
                                name: `Ligand entity ${entityId} (${compId}, label_asym_id ${instance.labelAsymId}, ${instance.instanceId ? `instance_id ${instance.instanceId}` : 'model'})`,
                                params: { entry: entryId, assemblyId: PREFERRED, entityId: entityId, labelAsymId: instance.labelAsymId, instanceId: instance.instanceId }
                            });
                        }
                    }
                }
                break;
            }
            case 'pdbconnect_summary_domains_default': {
                out.push({ kind: 'pdbconnect_summary_domains_default', name: `All domains`, params: { entry: entryId, assemblyId: PREFERRED } });
                break;
            }
            case 'pdbconnect_summary_domains_in_source': {
                const domains = await this.dataProvider.siftsMappingsByEntity(entryId);
                for (const source in domains) {
                    out.push({ kind: 'pdbconnect_summary_domains_in_source', name: `Domains in ${source}`, params: { entry: entryId, assemblyId: PREFERRED, source: source } });
                }
                break;
            }
            case 'pdbconnect_summary_domain': {
                const assemblies = await this.dataProvider.assemblies(entryId);
                const preferredAssembly = getPreferredAssembly(assemblies).assemblyId;
                const domains = await this.dataProvider.siftsMappingsByEntity(entryId);
                const modelData = await this.modelProvider.getModel(entryId);
                const chainInstancesInfo = getChainInstancesInAssemblies(modelData);
                for (const source in domains) {
                    const srcDomains = domains[source];
                    for (const familyId in srcDomains) {
                        const famDomains = srcDomains[familyId];
                        for (const entityId in famDomains) {
                            const entDomains = famDomains[entityId];
                            for (const domain of entDomains) {
                                const labelAsymId = domain.chunks[0].chainId;
                                let instances: (string | undefined)[] = chainInstancesInfo[preferredAssembly].operatorsPerChain[labelAsymId];
                                if (instances === undefined || instances.length === 0) instances = [undefined];
                                for (const instanceId of instances) {
                                    out.push({
                                        kind: 'pdbconnect_summary_domain',
                                        name: `Domain from ${source} ${familyId} ${domain.id} (label_asym_id ${labelAsymId},  ${instanceId ? `instance_id ${instanceId}` : 'model'})`,
                                        params: { entry: entryId, assemblyId: PREFERRED, source, familyId, entityId, domainId: domain.id, instanceId },
                                    });
                                }
                            }
                        }
                    }
                }
                break;
            }
            case 'pdbconnect_summary_all_modifications': {
                out.push({ kind: 'pdbconnect_summary_all_modifications', name: `All modified residues`, params: { entry: entryId, assemblyId: PREFERRED } });
                break;
            }
            case 'pdbconnect_summary_modification': {
                const modifiedResidues = await this.dataProvider.modifiedResidues(entryId);
                const assemblies = await this.dataProvider.assemblies(entryId);
                const preferredAssembly = getPreferredAssembly(assemblies).assemblyId;
                modifiedResidues.sort((a, b) => a.compoundId < b.compoundId ? -1 : a.compoundId === b.compoundId ? 0 : 1); // sort by compoundId
                const modelData = await this.modelProvider.getModel(entryId);
                const chainInstancesInfo = getChainInstancesInAssemblies(modelData);
                for (const modres of modifiedResidues) {
                    let instances: (string | undefined)[] = chainInstancesInfo[preferredAssembly].operatorsPerChain[modres.labelAsymId];
                    if (instances === undefined || instances.length === 0) instances = [undefined];
                    for (const instanceId of instances) {
                        out.push({
                            kind: 'pdbconnect_summary_modification',
                            name: `Modified residue ${modres.compoundId} (label_asym_id ${modres.labelAsymId} ${modres.labelSeqId},  ${instanceId ? `instance_id ${instanceId}` : 'model'})`,
                            params: { entry: entryId, assemblyId: PREFERRED, compId: modres.compoundId, labelAsymId: modres.labelAsymId, labelSeqId: modres.labelSeqId, instanceId },
                        });
                    }
                }
                break;
            }
            case 'pdbconnect_quality': {
                for (const validationType of ValidationTypes) {
                    out.push({ kind: 'pdbconnect_quality', name: `Validation (${validationType})`, params: { entry: entryId, assemblyId: MODEL, validation_type: validationType } });
                }
                break;
            }
            case 'pdbconnect_environment': {
                const entities = await this.dataProvider.entities(entryId);
                const assemblies = await this.dataProvider.assemblies(entryId);
                const preferredAssembly = getPreferredAssembly(assemblies).assemblyId;
                const modelData = await this.modelProvider.getModel(entryId);
                const chainInstancesInfo = getChainInstancesInAssemblies(modelData);
                const ligands = await this.dataProvider.ligands(entryId);
                const modifiedResidues = await this.dataProvider.modifiedResidues(entryId);
                modifiedResidues.sort((a, b) => a.compoundId < b.compoundId ? -1 : a.compoundId === b.compoundId ? 0 : 1); // sort by compoundId
                for (const ligand of ligands) {
                    if (!entityIsLigand(entities[ligand.entityId])) continue;
                    const compId = ligand.compoundId;
                    let instances: (string | undefined)[] = chainInstancesInfo[preferredAssembly].operatorsPerChain[ligand.labelAsymId];
                    if (instances === undefined || instances.length === 0) instances = [undefined];
                    for (const instanceId of instances) {
                        out.push({
                            kind: 'pdbconnect_environment',
                            name: `Ligand environment for ${compId} ${ligand.labelAsymId} [auth ${ligand.authAsymId} ${ligand.authSeqId}${ligand.authInsCode}] (${instanceId ? `instance_id ${instanceId}` : 'model'})`,
                            params: { entry: entryId, assemblyId: PREFERRED, labelAsymId: ligand.labelAsymId, authAsymId: ligand.authAsymId, authSeqId: ligand.authSeqId, authInsCode: ligand.authInsCode, instanceId, atomInteractions: 'api' },
                        });
                    }
                }
                for (const modres of modifiedResidues) {
                    let instances: (string | undefined)[] = chainInstancesInfo[preferredAssembly].operatorsPerChain[modres.labelAsymId];
                    if (instances === undefined || instances.length === 0) instances = [undefined];
                    for (const instanceId of instances) {
                        out.push({
                            kind: 'pdbconnect_environment',
                            name: `Modified residue environment for ${modres.compoundId} ${modres.labelAsymId} ${modres.labelSeqId} [auth ${modres.authAsymId} ${modres.authSeqId}${modres.authInsCode}] (${instanceId ? `instance_id ${instanceId}` : 'model'})`,
                            params: { entry: entryId, assemblyId: PREFERRED, labelAsymId: modres.labelAsymId, authAsymId: modres.authAsymId, authSeqId: modres.authSeqId, authInsCode: modres.authInsCode, instanceId, atomInteractions: 'builtin' },
                        });
                    }
                }
                break;
            }
            case 'pdbconnect_text_annotation': {
                const assemblies = await this.dataProvider.assemblies(entryId);
                const preferredAssembly = getPreferredAssembly(assemblies).assemblyId;
                const modelData = await this.modelProvider.getModel(entryId);
                const chainInstancesInfo = getChainInstancesInAssemblies(modelData);
                const annots = await this.dataProvider.llmAnnotations(entryId);
                for (const entityId in annots) {
                    const entityAnnots = annots[entityId];
                    for (const labelAsymId of Object.keys(entityAnnots).sort()) {
                        const chainAnnots = entityAnnots[labelAsymId];
                        let instances: (string | undefined)[] = chainInstancesInfo[preferredAssembly].operatorsPerChain[labelAsymId];
                        if (instances === undefined || instances.length === 0) instances = [undefined];
                        for (const instanceId of instances) {
                            out.push({
                                kind: 'pdbconnect_text_annotation',
                                name: `Entity ${entityId}: Annotations for chain (label_asym_id ${labelAsymId}, ${instanceId ? `instance_id ${instanceId}` : 'model'})`,
                                params: { entry: entryId, assemblyId: PREFERRED, entityId, labelAsymId, labelSeqId: undefined, instanceId },
                            });
                            for (const labelSeqId in chainAnnots) {
                                const residueAnnots = chainAnnots[labelSeqId];
                                out.push({
                                    kind: 'pdbconnect_text_annotation',
                                    name: `Entity ${entityId}: Annotations for residue ${labelSeqId} [auth ${residueAnnots[0].authorResidueNumber}] (label_asym_id ${labelAsymId}, ${instanceId ? `instance_id ${instanceId}` : 'model'})`,
                                    params: { entry: entryId, assemblyId: PREFERRED, entityId, labelAsymId, labelSeqId: Number(labelSeqId), instanceId },
                                });
                            }
                        }
                    }
                }
                break;
            }
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
}
