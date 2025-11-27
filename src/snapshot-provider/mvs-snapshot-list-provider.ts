import { IDataProvider } from './data-provider';
import { entityIsLigand, entityIsMacromolecule, getPreferredAssembly, listEntityInstancesInAssembly, listEntityInstancesInModel, uniqueModresCompIds } from './helpers';
import { IModelProvider } from './model-provider';
import { PREFERRED, SnapshotKind, SnapshotKinds, SnapshotSpec, ValidationTypes } from './mvs-snapshot-types';
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
                            // const entDomains = famDomains[entityId];
                            // for (const domain of entDomains) {
                            //     out.push({ kind: 'domain', name: `Domain ${domain.id}: ${source} ${familyId} in entity ${entityId}`, params: { entry: entryId, source, entityId, familyId } });
                            //     // TODO allow all-domain-in-chain view (with specific chain or auto) and specific-domain view?
                            // }
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
                        // out.push({ kind: 'pdbconnect_summary_macromolecule', name: `Entity ${entityId} (first instance)`, params: { entry: entryId, assemblyId: PREFERRED, entityId: entityId, labelAsymId: undefined, instanceId: undefined } });
                        // for (const labelAsymId of entity.chains) {
                        //     out.push({ kind: 'pdbconnect_summary_macromolecule', name: `Entity ${entityId} (label_asym_id ${labelAsymId})`, params: { entry: entryId, assemblyId: PREFERRED, entityId: entityId, labelAsymId: labelAsymId } });
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
                                        params: { entry: entryId, assemblyId: PREFERRED, source, familyId, labelAsymId, instanceId: undefined },
                                    });
                                }
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
