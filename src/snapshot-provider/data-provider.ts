import { unique } from './helpers';


export interface IPdbeApiClient {
    /** Resolve to parsed JSON object obtained from API endpoint, or `undefined` if status code is 404.
     * 
     * E.g. `await get('pdb/entry/summary/1tqn')` -> `{ 1tqn: [...] }` (corresponds to https://www.ebi.ac.uk/pdbe/api/v2/pdb/entry/summary/1tqn) */
    get<T>(relativeUrl: string): Promise<T | undefined>,
}


export class PdbeApiClient implements IPdbeApiClient {
    private readonly apiBaseUrl: string;

    /** Cache for currently running or resolved promises */
    private readonly cache: { [url: string]: Promise<any> } = {};

    constructor(apiBaseUrl: string) {
        this.apiBaseUrl = apiBaseUrl.replace(/\/$/, ''); // trim final slash
    }

    private async getWithoutCache<T>(relativeUrl: string): Promise<T | undefined> {
        const url = `${this.apiBaseUrl}/${relativeUrl}`;
        console.log('GET', url);
        const response = await fetch(url);
        if (response.status === 404) return undefined; // PDBe API returns 404 in some cases (e.g. when there are no modified residues)
        if (!response.ok) throw new Error(`API call failed with code ${response.status} (${url})`);
        return await response.json();
    }
    get<T>(relativeUrl: string): Promise<T | undefined> {
        return this.cache[relativeUrl] ??= this.getWithoutCache<T>(relativeUrl);
    }
}


export interface IDataProvider {
    assemblies(entryId: string): Promise<AssemblyRecord[]>,
    entities(pdbId: string): Promise<{ [entityId: string]: EntityRecord }>,
    ligands(pdbId: string): Promise<ResidueRecord[]>,
    modifiedResidues(pdbId: string): Promise<ResidueRecord[]>,
    entitiesInAssemblies(pdbId: string): Promise<{ [entityId: string]: { assemblies: string[] } }>,
    chainsInAssemblies(pdbId: string): Promise<{ [labelAsymId: string]: { assemblies: string[] } }>,
    siftsMappings(pdbId: string): Promise<{ [source: string]: { [family: string]: DomainRecord[] } }>,
    siftsMappingsByEntity(pdbId: string): Promise<{ [source: string]: { [family: string]: { [entityId: string]: DomainRecord[] } } }>,
    authChainCoverages(pdbId: string): Promise<{ [authAsymId: string]: number }>,
    experimentalMethods(pdbId: string): Promise<string[]>,
    pdbeStructureQualityReport(pdbId: string): Promise<ValidationApiData[string] | undefined>,
    atomInteractions(pdbId: string, authAsymId: string, authSeqId: number): Promise<InteractionsApiData[string]>,
    llmAnnotations(pdbId: string): Promise<LlmAnnotations>,
}


export class ApiDataProvider implements IDataProvider {
    constructor(private readonly pdbeApiWrapper: IPdbeApiClient) { }

    private get<T>(relativeUrl: string): Promise<T | undefined> {
        return this.pdbeApiWrapper.get(relativeUrl);
    }


    async assemblies(pdbId: string): Promise<AssemblyRecord[]> {
        const json = await this.get<SummaryApiData>(`pdb/entry/summary/${pdbId}`);
        const assemblies: AssemblyRecord[] = [];
        for (const record of json?.[pdbId] ?? []) {
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
        const json = await this.get<MoleculesApiData>(`pdb/entry/molecules/${pdbId}`);
        const result: { [entityId: string]: EntityRecord } = {};
        for (const record of json?.[pdbId] ?? []) {
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
        const json = await this.get<LigandMonomersApiData>(`pdb/entry/ligand_monomers/${pdbId}`);
        const result: ResidueRecord[] = [];
        for (const record of json?.[pdbId] ?? []) {
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
        const json = await this.get<ModifiedResiduesApiData>(`pdb/entry/modified_AA_or_NA/${pdbId}`);
        const result: ResidueRecord[] = [];
        for (const record of json?.[pdbId] ?? []) {
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
        const json = await this.get<AssemblyApiData>(`pdb/entry/assembly/${pdbId}`);
        const out: Awaited<ReturnType<IDataProvider['entitiesInAssemblies']>> = {};
        for (const record of json?.[pdbId] ?? []) {
            for (const entity of record.entities ?? []) {
                out[entity.entity_id] ??= { assemblies: [] };
                out[entity.entity_id].assemblies.push(record.assembly_id);
            }
        }
        return out;
    }

    async chainsInAssemblies(pdbId: string) {
        const json = await this.get<AssemblyApiData>(`pdb/entry/assembly/${pdbId}`);
        const out: Awaited<ReturnType<IDataProvider['chainsInAssemblies']>> = {};
        for (const record of json?.[pdbId] ?? []) {
            for (const entity of record.entities ?? []) {
                for (const chain of entity.in_chains) {
                    const [labelAsymId, instanceSuffix] = chain.split('-'); // assuming chains are named like "A", "B-2", ...
                    out[labelAsymId] ??= { assemblies: [] };
                    out[labelAsymId].assemblies.push(record.assembly_id);
                }
            }
        }
        for (const labelAsymId in out) {
            out[labelAsymId].assemblies = unique(out[labelAsymId].assemblies);
        }
        return out;
    }

    /** Get list of instances of SIFTS domains within a PDB entry,
     * sorted by source (CATH, Pfam, Rfam, SCOP) and family (e.g. 1.10.630.10, PF00067). */
    async siftsMappings(pdbId: string) {
        const jsonProtein = await this.get<MappingsApiData>(`mappings/${pdbId}`);
        const jsonNucleic = await this.get<MappingsApiData>(`nucleic_mappings/${pdbId}`);
        const entryDataProtein = jsonProtein?.[pdbId] ?? {};
        const entryDataNucleic = jsonNucleic?.[pdbId] ?? {};
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
        const json = await this.get<PolymerCoverageApiData>(`pdb/entry/polymer_coverage/${pdbId}`);
        const coverages: { [authAsymId: string]: number } = {};
        for (const entity of json?.[pdbId]?.molecules ?? []) {
            for (const chain of entity.chains ?? []) {
                const authAsymId = chain.chain_id;
                coverages[authAsymId] ??= 0;
                for (const range of chain.observed ?? []) {
                    const length = range.end.residue_number - range.start.residue_number + 1;
                    coverages[authAsymId] += length;
                }
            }
        }
        return coverages;
    }

    /** Get list of experimental methods for a PDB entry. */
    async experimentalMethods(pdbId: string): Promise<string[]> {
        const json = await this.get<SummaryApiData>(`pdb/entry/summary/${pdbId}`);
        const methods: string[] = [];
        for (const record of json?.[pdbId] ?? []) {
            for (const method of record.experimental_method ?? []) {
                methods.push(method);
            }
        }
        return methods;
    }

    /** Get PDBe Structure Quality Report */
    async pdbeStructureQualityReport(pdbId: string) {
        const json = await this.get<ValidationApiData>(`validation/residuewise_outlier_summary/entry/${pdbId}`);
        return json?.[pdbId];
    }

    async atomInteractions(pdbId: string, authAsymId: string, authSeqId: number) {
        const json = await this.get<InteractionsApiData>(`pdb/bound_ligand_interactions/${pdbId}/${authAsymId}/${authSeqId}?preserve_case=true`);
        return json?.[pdbId] ?? [];
    }

    async llmAnnotations(pdbId: string) {
        const json = await this.get<LlmSummaryApiData>(`pdb/entry/llm_annotations/summary/${pdbId}`);
        const out: LlmAnnotations = {};
        for (const provider of json?.[pdbId]?.data ?? []) {
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
    }
}


/** Helper function to convert a domain mapping (describes one domain) from PDBeAPI format to a `DomainRecord`. */
function extractDomainMappings(mappings: MappingsApiData[string][string][string]['mappings'], source: string, family: string, familyName: string): DomainRecord[] {
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
export interface DomainChunkRecord {
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

/** Response of `pdb/entry/summary/${pdbId}` */
export interface SummaryApiData {
    [pdbId: string]: Array<{
        /** PDB entry title, e.g. "Crystal Structures of Nipah Virus G Attachment Glycoprotein" */
        title: string,
        /** e.g. "RCSB" */
        processing_site: string,
        /** e.g. "RCSB" */
        deposition_site: string,
        /** e.g. "20080502" */
        deposition_date: string,
        /** e.g. "20080502" */
        release_date: string,
        /** e.g. "20080502" */
        revision_date: string,
        /** e.g. ["x-ray"] */
        experimental_method_class: string[],
        /** e.g. ["X-ray diffraction"] */
        experimental_method: string[],
        split_entry: any[],
        related_structures: any[],
        entry_authors: string[],
        number_of_entities: {
            water: number,
            polypeptide: number,
            dna: number,
            rna: number,
            sugar: number,
            ligand: number,
            'dna/rna': number,
            other: number,
            carbohydrate_polymer: number,
            peptide_nucleic_acid: number,
            cyclic_pseudo_peptide: number,
        },
        assemblies: Array<{
            /** e.g. "1" */
            assembly_id: string,
            /** e.g. "tetramer" */
            name: string,
            /** e.g. "hetero" */
            form: string,
            preferred: boolean,
        }>,
    }>,
}

/** Response of `pdb/entry/molecules/${pdbId}` */
export interface MoleculesApiData {
    [pdbId: string]: Array<{
        /** e.g. "polypeptide(L)" */
        molecule_type: string,
        entity_id: number,
        sample_preparation: string,
        length: number,
        number_of_copies: number,
        /** Occurrence in chains by auth_asym_id */
        in_chains: string[],
        /** Occurrence in chains by label_asym_id */
        in_struct_asyms: string[],
        mutation_flag: any,
        /** Molecular weight in Da */
        weight: number,
        ca_p_only: boolean,
        /** Entity name as stated in mmCIF file */
        synonym?: string,
        /** Entity names mapped from UniProt etc. */
        molecule_name: string[],
        gene_name?: string[],
        /** Source organism */
        source?: Array<any>,
        sequence?: string,
        pdb_sequence?: string,
        pdb_sequence_indices_with_multiple_residues?: any,
        /** CCD codes (for ligands etc.) */
        chem_comp_ids?: string[],
    }>,
}

/** Response of `pdb/entry/ligand_monomers/${pdbId}` */
export interface LigandMonomersApiData {
    [pdbId: string]: Array<{
        /** auth_asym_id */
        chain_id: string,
        author_residue_number: number,
        author_insertion_code: string,
        chem_comp_id: string,
        alternate_conformers: number,
        entity_id: number,
        /** label_asym_id */
        struct_asym_id: "B",
        residue_number: number,
        /** e.g. "RETINOIC ACID" */
        chem_comp_name: string,
        /** Molecular weight in Da */
        weight: string,
        carbohydrate_polymer: boolean,
        branch_name: string,
        /** e.g. "bm1" */
        bm_id: string,
        annotations: any[],
    }>,
}

/** Response of `pdb/entry/modified_AA_or_NA/${pdbId}` */
export interface ModifiedResiduesApiData {
    [pdbId: string]: Array<{
        /** auth_asym_id */
        chain_id: string,
        author_residue_number: number,
        author_insertion_code: string,
        chem_comp_id: string,
        alternate_conformers: number,
        entity_id: number,
        /** label_asym_id */
        struct_asym_id: string,
        residue_number: number,
        /** e.g. "(3-AMINO-2,5-DIOXO-1-PYRROLIDINYL)ACETIC ACID" */
        chem_comp_name: string,
        /** e.g. "ENDOTHIAPEPSIN" */
        description: string,
        /** Molecular weight of the whole chain perhaps, in Da */
        weight: number,
    }>
}

/** Response of `mappings/${pdbId}`, `nucleic_mappings/${pdbId}`.
 * This is not exhaustive, records from different source databases contain different fields. */
export interface MappingsApiData {
    [pdbId: string]: {
        [source: string]: {
            [familyId: string]: {
                name: string,
                identifier: string,
                mappings: Array<{
                    entity_id: number,
                    /** auth_asym_id */
                    chain_id: string,
                    /** label_asym_id */
                    struct_asym_id: string,
                    unp_start?: number,
                    unp_end?: number,
                    start: {
                        author_residue_number: number,
                        author_insertion_code: string,
                        residue_number: number,
                    },
                    end: {
                        author_residue_number: number,
                        author_insertion_code: string,
                        residue_number: number,
                    },
                    /** For CATH records, e.g. "1hdaA00" */
                    domain?: string,
                    /** For SCOP records, e.g. "d1hdaa_" */
                    scop_id: string,
                }>,
            },
        },
    },
}

/** Response of `pdb/entry/polymer_coverage/${pdbId}` */
export interface PolymerCoverageApiData {
    [pdbId: string]: {
        "molecules": Array<{
            "entity_id": number,
            "chains": Array<{
                /** label_asym_id */
                "struct_asym_id": string,
                /** auth_asym_id */
                "chain_id": string,
                "observed": Array<{
                    "start": {
                        "residue_number": number,
                        "author_residue_number": number,
                        "author_insertion_code": string | null,
                        "struct_asym_id": string,
                    },
                    "end": {
                        "residue_number": number,
                        "author_residue_number": number,
                        "author_insertion_code": string | null,
                        "struct_asym_id": string,
                    }
                }>,
            }>
        }>,
    },
}

/** Response of `validation/residuewise_outlier_summary/entry/${pdbId}` */
export interface ValidationApiData {
    [pdbId: string]: {
        molecules: Array<{
            entity_id: number,
            chains: Array<{
                chain_id: string,
                struct_asym_id: string,
                models: Array<{
                    model_id: number,
                    residues: Array<{
                        residue_number: number,
                        author_residue_number: number | string, // this hurts but yes, sometimes it's a string (e.g. 8eiu entity 6 chain F [auth A])
                        author_insertion_code: string,
                        alt_code: string,
                        outlier_types: string[],
                    }>,
                }>,
            }>,
        }>,
    },
}

/** Response of `pdb/entry/assembly/${pdbId}` */
export interface AssemblyApiData {
    [pdbId: string]: Array<{
        entities: Array<{
            entity_id: number,
            /** label_asym_ids with instanceID suffixes (except for the first instance), e.g. ["A", "B-2"] */
            in_chains: string[],
            /** e.g. "carbohydrate polymer" */
            molecule_type: string,
            number_of_copies: number,
            molecule_name: string[],
        }>,
        assembly_id: string,
        assembly_composition: string,
        molecular_weight: number,
        polymeric_count: number,
        /** e.g. "software_defined_assembly", "author_and_software_defined_assembly" */
        details: string,
    }>,
}

export interface InteractionsApiData {
    [pdbId: string]: Array<{
        interactions: Array<{
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
        }>,
        ligand: {
            author_insertion_code?: string,
            author_residue_number: number,
            /** auth_asym_id */
            chain_id: string,
            chem_comp_id: string,
        },
    }>,
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
        data: Array<{
            provider: string,
            residueList: Array<{
                startIndex: number,
                endIndex: number,
                indexType: 'PDB' | 'UNIPROT',
                additionalData: LlmAnnotationItem[],
            }>,
        }>,
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
