export interface IDataProvider {
    assemblies(entryId: string): Promise<AssemblyRecord[]>,
    entities(pdbId: string): Promise<{ [entityId: string]: EntityRecord }>,
    ligands(pdbId: string): Promise<ResidueRecord[]>,
    modifiedResidues(pdbId: string): Promise<ResidueRecord[]>,
    entitiesInAssemblies(pdbId: string): Promise<{ [entityId: string]: { assemblies: string[] } }>,
    siftsMappings(pdbId: string): Promise<{ [source: string]: { [family: string]: DomainRecord[] } }>,
    siftsMappingsByEntity(pdbId: string): Promise<{ [source: string]: { [family: string]: { [entity: string]: DomainRecord[] } } }>,
    authChainCoverages(pdbId: string): Promise<{ [chainId: string]: number }>,
    experimentalMethods(pdbId: string): Promise<string[]>,
    pdbeStructureQualityReport(pdbId: string): Promise<PdbeStructureQualityReport | undefined>,
    atomInteractions(pdbId: string, authAsymId: string, authSeqId: number): Promise<InteractionsApiData[string]>,
    llmAnnotations(pdbId: string): Promise<LlmAnnotations>,
}


export class ApiDataProvider implements IDataProvider {
    private readonly apiBaseUrl: string;

    /** Cache for currently running or resolved promises */
    private readonly cache: { [url: string]: Promise<any> } = {};

    constructor(apiBaseUrl: string) {
        this.apiBaseUrl = apiBaseUrl.replace(/\/$/, ''); // trim final slash
    }

    private async getWithoutCache(url: string): Promise<any> {
        console.log('GET', url);
        const response = await fetch(url);
        if (response.status === 404) return {}; // PDBe API returns 404 in some cases (e.g. when there are no modified residues)
        if (!response.ok) throw new Error(`API call failed with code ${response.status} (${url})`);
        return await response.json();
    }
    private get(url: string): Promise<any> {
        return this.cache[url] ??= this.getWithoutCache(url);
    }


    async assemblies(entryId: string): Promise<AssemblyRecord[]> {
        const url = `${this.apiBaseUrl}/pdb/entry/summary/${entryId}`;
        const json = await this.get(url);
        const assemblies: AssemblyRecord[] = [];
        for (const record of json[entryId] ?? []) {
            for (const assembly of record.assemblies) {
                assemblies.push({
                    assemblyId: assembly.assembly_id,
                    form: assembly.form,
                    preferred: assembly.preferred,
                    name: assembly.name,
                });
            }
        }
        return assemblies;
    }


    /** Get type and residue code (chem_comp_id, when it makes sense) of entities within a PDB entry. */
    async entities(pdbId: string): Promise<{ [entityId: string]: EntityRecord }> {
        const url = `${this.apiBaseUrl}/pdb/entry/molecules/${pdbId}`;
        const json = await this.get(url);
        const result: { [entityId: string]: EntityRecord } = {};
        for (const record of json[pdbId] ?? []) {
            result[record.entity_id] = {
                id: `${record.entity_id}`, // entity ID is string, even though the API may serve it as number
                name: record.molecule_name.join(' / '), // concatenating in case of chimeras, e.g. 6hr1
                type: record.molecule_type,
                compIds: record.chem_comp_ids ?? [],
                chains: record.in_struct_asyms ?? [],
            };
        }
        return result;
    }

    /** Get list of instances of ligands within a PDB entry. */
    async ligands(pdbId: string): Promise<ResidueRecord[]> {
        const url = `${this.apiBaseUrl}/pdb/entry/ligand_monomers/${pdbId}`;
        const json = await this.get(url);
        const result: ResidueRecord[] = [];
        for (const record of json[pdbId] ?? []) {
            result.push({
                entityId: `${record.entity_id}`, // API serves as number, we need string
                labelAsymId: record.struct_asym_id,
                labelSeqId: record.residue_number,
                authAsymId: record.chain_id,
                authSeqId: record.author_residue_number,
                authInsCode: record.author_insertion_code ?? '',
                compoundId: record.chem_comp_id,
                compoundName: record.chem_comp_name,
            });
        }
        return result;
    }

    /** Get list of instances of modified residues within a PDB entry. */
    async modifiedResidues(pdbId: string): Promise<ResidueRecord[]> {
        const url = `${this.apiBaseUrl}/pdb/entry/modified_AA_or_NA/${pdbId}`;
        const json = await this.get(url);
        const result: ResidueRecord[] = [];
        for (const record of json[pdbId] ?? []) {
            result.push({
                entityId: `${record.entity_id}`, // API serves as number, we need string
                labelAsymId: record.struct_asym_id,
                labelSeqId: record.residue_number,
                authAsymId: record.chain_id,
                authSeqId: record.author_residue_number,
                authInsCode: record.author_insertion_code ?? '',
                compoundId: record.chem_comp_id,
                compoundName: record.chem_comp_name,
            });
        }
        return result;
    }

    async entitiesInAssemblies(pdbId: string) {
        const url = `${this.apiBaseUrl}/pdb/entry/assembly/${pdbId}`;
        const json = await this.get(url);
        const out: Awaited<ReturnType<IDataProvider['entitiesInAssemblies']>> = {};
        for (const record of json[pdbId] ?? []) {
            for (const entity of record.entities ?? []) {
                out[entity.entity_id] ??= { assemblies: [] };
                out[entity.entity_id].assemblies.push(record.assembly_id);
            }
            // out[record.assembly_id] = record.entities.map((e: any) => e.entity_id as string);
        }
        return out;
    }
    /** Get list of instances of SIFTS domains within a PDB entry,
     * sorted by source (CATH, Pfam, Rfam, SCOP) and family (e.g. 1.10.630.10, PF00067). */
    async siftsMappings(pdbId: string) {
        const jsonProtein = await this.get(`${this.apiBaseUrl}/mappings/${pdbId}`);
        const jsonNucleic = await this.get(`${this.apiBaseUrl}/nucleic_mappings/${pdbId}`);
        const entryDataProtein = jsonProtein[pdbId] ?? {};
        const entryDataNucleic = jsonNucleic[pdbId] ?? {};
        const entryData = { ...entryDataProtein, ...entryDataNucleic };

        const result = {} as { [source: string]: { [family: string]: DomainRecord[] } };
        // for (const source of SIFTS_SOURCES) {
        for (const source in entryData) {
            result[source] = {};
            const sourceData = entryData[source] ?? {};
            for (const family of Object.keys(sourceData).sort()) {
                const familyName = sourceData[family].identifier;
                const mappings = sourceData[family].mappings;
                result[source][family] = extractDomainMappings(mappings, source, family, familyName);
            }
        }
        return result;
    }
    async siftsMappingsByEntity(pdbId: string) {
        const mappings = await this.siftsMappings(pdbId);
        return sortDomainsByEntity(mappings);
    }

    /** Get absolute number of modelled residues in each chain */
    async authChainCoverages(pdbId: string): Promise<{ [chainId: string]: number }> {
        const url = `${this.apiBaseUrl}/pdb/entry/polymer_coverage/${pdbId}`;
        const json = await this.get(url);
        const coverages: { [chainId: string]: number } = {};
        for (const entity of json[pdbId]?.molecules ?? []) {
            for (const chain of entity.chains ?? []) {
                // const chainId = chain.struct_asym_id;
                const chainId = chain.chain_id;
                coverages[chainId] ??= 0;
                for (const range of chain.observed ?? []) {
                    const length = range.end.residue_number - range.start.residue_number + 1;
                    coverages[chainId] += length;
                }
            }
        }
        return coverages;
    }

    /** Get list of experimental methods for a PDB entry. */
    async experimentalMethods(pdbId: string): Promise<string[]> {
        const url = `${this.apiBaseUrl}/pdb/entry/summary/${pdbId}`;
        const json = await this.get(url);
        const methods: string[] = [];
        for (const record of json[pdbId] ?? []) {
            for (const method of record.experimental_method ?? []) {
                methods.push(method);
            }
        }
        return methods;
    }

    /** Get PDBe Structure Quality Report */
    async pdbeStructureQualityReport(pdbId: string): Promise<PdbeStructureQualityReport | undefined> {
        const url = `${this.apiBaseUrl}/validation/residuewise_outlier_summary/entry/${pdbId}`;
        const json = await this.get(url);
        const data = json[pdbId] as PdbeStructureQualityReport;
        return data;
    }

    async atomInteractions(pdbId: string, authAsymId: string, authSeqId: number) {
        const url = `${this.apiBaseUrl}/pdb/bound_ligand_interactions/${pdbId}/${authAsymId}/${authSeqId}?preserve_case=true`;
        const json: InteractionsApiData = await this.get(url);
        return json[pdbId] ?? [];
    }

    async llmAnnotations(pdbId: string) {
        const url = `${this.apiBaseUrl}/pdb/entry/llm_annotations/summary/${pdbId}`;
        const json: LlmSummaryApiData = await this.get(url);
        const out: LlmAnnotations = {};
        for (const provider of json[pdbId]?.data ?? []) {
            for (const residue of provider.residueList) {
                for (const annot of residue.additionalData) {
                    const entityId = annot.entityId
                    const labelAsymId = annot.pdbChain;
                    const labelSeqId = annot.pdbResidue;
                    const residueAnnotations = ((out[entityId] ??= {})[labelAsymId] ??= {})[labelSeqId] ??= [];
                    residueAnnotations.push(annot);
                }
            }
        }
        return out;
        // return json[pdbId] ?? [];
    }
}

type PdbeStructureQualityReport = {
    molecules: {
        entity_id: number,
        chains: {
            chain_id: string,
            struct_asym_id: string,
            models: {
                model_id: number,
                residues: {
                    residue_number: number,
                    author_residue_number: number | string, // this hurts but yes, sometimes it's a string (e.g. 8eiu entity 6 chain F [auth A])
                    author_insertion_code: string,
                    alt_code: string,
                    outlier_types: string[],
                }[],
            }[],
        }[],
    }[],
}


/** Helper function to convert a domain mapping (describes one domain) from PDBeAPI format to a `DomainRecord`. */
function extractDomainMappings(mappings: any[], source: string, family: string, familyName: string): DomainRecord[] {
    const result: { [domainId: string]: DomainRecord } = {};
    const domainCount: { [chain: string]: number } = {};
    function getAdHocDomainId(chain: string) {
        domainCount[chain] ??= 0;
        const num = ++domainCount[chain]; // counting from 1
        return num === 1 ? `${family}_${chain}` : `${family}_${chain}_${num}`;
    }
    for (const mapping of mappings) {
        const domainId = mapping.domain ?? mapping.scop_id ?? getAdHocDomainId(mapping.chain_id);
        const existingDomain = result[domainId];
        const chunk: DomainChunkRecord = {
            entityId: String(mapping.entity_id),
            chainId: mapping.struct_asym_id,
            authChainId: mapping.chain_id,
            startResidue: mapping.start?.residue_number,
            endResidue: mapping.end?.residue_number,
            segment: existingDomain ? existingDomain.chunks.length + 1 : 1,
        };
        if (chunk.startResidue !== undefined && chunk.endResidue !== undefined && chunk.startResidue > chunk.endResidue) {
            [chunk.startResidue, chunk.endResidue] = [chunk.endResidue, chunk.startResidue]; // you never know with the PDBe API, LOL
        }
        if (existingDomain) {
            existingDomain.chunks.push(chunk);
        } else {
            result[domainId] = {
                id: domainId,
                source: source,
                family: family,
                familyName: familyName,
                chunks: [chunk],
            };
        }
    }
    return Object.values(result).sort((a, b) => a.id < b.id ? -1 : 1);
}

/** Reorganize domains from source-family to source-family-entity */
export function sortDomainsByEntity(domains: { [source: string]: { [family: string]: DomainRecord[] } }) {
    const result = {} as { [source: string]: { [family: string]: { [entityId: string]: DomainRecord[] } } };
    for (const [source, sourceDomains] of Object.entries(domains)) {
        for (const [family, familyDomains] of Object.entries(sourceDomains)) {
            for (const domain of familyDomains) {
                const entityId = domain.chunks[0].entityId;
                (((result[source] ??= {})[family] ??= {})[entityId] ??= []).push(domain);
            }
        }
    }
    return result;
}



/** Represents one assembly of a PDB entry. */
export interface AssemblyRecord {
    /** Assembly ID, usually '1', '2' etc. */
    assemblyId: string,
    /** Usually 'homo' or 'hetero' */
    form: string,
    /** Flags if this is the preferred assembly (should be only one for each PDB entry) */
    preferred: boolean,
    /** Assembly description like 'monomer', 'tetramer' etc. */
    name: string,
}

export interface EntityRecord {
    id: string,
    name: string,
    type: string,
    compIds: string[],
    /** List of label_asym_ids corresponding to this entity */
    chains: string[],
}

/** Represents one instance of a ligand or modified residue. */
export interface ResidueRecord {
    entityId: string,
    labelAsymId: string,
    labelSeqId: number,
    authAsymId: string,
    authSeqId: number,
    authInsCode: string,
    /** Compound code, e.g. 'MSE' */
    compoundId: string,
    /** Full compound code, e.g. 'Selenomethionine' */
    compoundName: string,
}

export interface DomainRecord {
    id: string,
    source: string,
    family: string,
    familyName: string,
    chunks: DomainChunkRecord[],
}

/** Represents one contiguous residue range forming a domain */
interface DomainChunkRecord {
    /** label_entity_id */
    entityId: string,
    /** label_asym_id */
    chainId: string,
    /** auth_asym_id */
    authChainId: string,
    /** label_seq_id of the first residue */
    startResidue: number | undefined,
    /** label_seq_id of the last residue */
    endResidue: number | undefined,
    /** No idea what this was supposed to mean in the original process (probably segment number
     * from the API before cutting into smaller segments by removing missing residues) */
    segment: number,
}

export interface InteractionsApiData {
    [pdbId: string]: {
        interactions: {
            end: {
                /** e.g. 'CZ' */
                atom_names: string[],
                author_insertion_code?: string,
                author_residue_number: number,
                /** auth_asym_id */
                chain_id: string,
                chem_comp_id: string,
            },
            distance: number,
            /** e.g. 'AMIDERING', 'CARBONPI', 'DONORPI', 'carbonyl', 'covalent', 'hbond', 'hydrophobic', 'metal_complex', 'polar', 'vdw', 'vdw_clash', 'weak_hbond', 'weak_polar'... */
            interaction_details: string[],
            /** e.g.'atom-atom' */
            interaction_type: string,
            /** e.g. 'C11' */
            ligand_atoms: string[],
        }[],
        ligand: {
            author_insertion_code?: string,
            author_residue_number: number,
            /** auth_asym_id */
            chain_id: string,
            chem_comp_id: string,
        },
    }[],
}

export interface LlmAnnotationItem {
    // pubmedId: 27050129,
    // pmcId: "PMC4822562",
    // doi: "10.1107/S2059798316001248",
    // primaryCitation: "Y",
    // openAccess: "N",
    entityId: number,
    /** label_seq_id */
    pdbResidue: number,
    /** auth_seq_id */
    authorResidueNumber: number,
    /** label_asym_id (comes from Validation XML field `said`, confirmed with Melanie) */
    pdbChain: string,
    uniprotAccession: string,
    uniprotResidue: number,
    sentence: string,
    // section: "display-objects",
    // exact: string,
    // entityType: "residue_name_number",
    // annotator: "autoannotator_v2.1_quant",
    aiScore: number,
}

interface LlmSummaryApiData {
    [pdbId: string]: {
        dataType: string,
        data: {
            provider: string,
            residueList: {
                startIndex: number,
                endIndex: number,
                indexType: 'PDB' | 'UNIPROT',
                additionalData: LlmAnnotationItem[],
            }[],
        }[],
    },
}

export interface LlmAnnotations {
    [entityId: string]: {
        [labelAsymId: string]: {
            [labelSeqId: number]: LlmAnnotationItem[],
        },
    },
}

// /** List of supported SIFTS source databases */
// const SIFTS_SOURCES = ['CATH', 'Pfam', 'Rfam', 'SCOP'] as const;
// /** SIFTS source database */
// export type SiftsSource = typeof SIFTS_SOURCES[number];
