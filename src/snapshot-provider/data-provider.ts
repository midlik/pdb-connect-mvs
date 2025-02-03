
export interface IDataProvider {
    assemblies(entryId: string): Promise<AssemblyRecord[]>,
    entities(pdbId: string): Promise<{ [entityId: string]: EntityRecord }>,
    modifiedResidues(pdbId: string): Promise<ModifiedResidueRecord[]>,
    entitiesInAssemblies(pdbId: string): Promise<{ [entityId: string]: { assemblies: string[] } }>,
}


export class ApiDataProvider implements IDataProvider {
    private readonly apiBaseUrl: string;

    /** Cache for currently running or resolved promises */
    private readonly cache: { [url: string]: Promise<any> } = {};

    constructor(apiBaseUrl: string) {
        this.apiBaseUrl = apiBaseUrl.replace(/\/$/, ''); // trim final slash
    }

    private async getWithoutCache(url: string): Promise<any> {
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
        console.log('base', this.apiBaseUrl)
        console.log('url', url)
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
    async entities(pdbId: string): Promise<{ [entityId: number]: EntityRecord }> {
        const url = `${this.apiBaseUrl}/pdb/entry/molecules/${pdbId}`;
        const json = await this.get(url);
        const result: { [entityId: number]: EntityRecord } = {};
        for (const record of json[pdbId] ?? []) {
            console.log('record', record)
            result[record.entity_id] = {
                names: record.molecule_name ?? [],
                type: record.molecule_type,
                compIds: record.chem_comp_ids ?? [],
            };
        }
        return result;
    }

    /** Get list of instances of modified residues within a PDB entry. */
    async modifiedResidues(pdbId: string): Promise<ModifiedResidueRecord[]> {
        const url = `${this.apiBaseUrl}/pdb/entry/modified_AA_or_NA/${pdbId}`;
        const json = await this.get(url);
        const result: ModifiedResidueRecord[] = [];
        for (const record of json[pdbId] ?? []) {
            result.push({
                entityId: record.entity_id,
                labelAsymId: record.struct_asym_id,
                authAsymId: record.chain_id,
                labelSeqId: record.residue_number,
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
    names: string,
    type: string,
    compIds: string[],
}

/** Represents one instance of a modified residue. */
export interface ModifiedResidueRecord {
    entityId: number,
    labelAsymId: string,
    authAsymId: string,
    labelSeqId: number,
    /** Compound code, e.g. 'MSE' */
    compoundId: string,
    /** Full compound code, e.g. 'Selenomethionine' */
    compoundName: string,
}
