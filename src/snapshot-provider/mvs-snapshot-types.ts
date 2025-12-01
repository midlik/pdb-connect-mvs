export type SnapshotSpecParams = {
    // TODO think about how to deal with mandatory (hopefully exhaustible) params vs optional params
    entry: { entry: string },
    assembly: { entry: string, assemblyId: string },
    entity: { entry: string, entityId: string, assemblyId?: string },
    domain: { entry: string, source: string, familyId: string, entityId: string }, // source / family / entity / chain / instance
    ligand: { entry: string, compId: string, labelAsymId?: string },
    modres: { entry: string, compId: string },
    bfactor: { entry: string },
    validation: { entry: string, validation_type: ValidationType },
    pdbconnect_summary_default: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly) */
        assemblyId: string,
    },
    pdbconnect_summary_macromolecule: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
        /** Entity ID of the macromolecule (polymer or branched) entity */
        entityId: string,
        /** TODO docstring or make required */
        labelAsymId?: string,
        /** Symmetry instance identifier (e.g. 'ASM-1'), `undefined` for showing all instances */
        instanceId?: string,
    },
    pdbconnect_summary_all_ligands: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
    },
    pdbconnect_summary_ligand: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
        /** Entity ID of the ligand entity */
        entityId: string,
        /** TODO docstring or make required */
        labelAsymId?: string,
        /** Symmetry instance identifier (e.g. 'ASM-1'), `undefined` for showing all instances */
        instanceId?: string,
    },
    pdbconnect_summary_domains_default: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
    },
    pdbconnect_summary_domains_in_source: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
        /** Source database (CATH | SCOP | Pfam) */
        source: string,
    },
    pdbconnect_summary_domain: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
        /** Source database (CATH | SCOP | Pfam) */
        source: string,
        /** Domain family ID (e.g. '1.10.630.10') */
        familyId: string,
        /** Entity identifier (label_entity_id) */
        entityId: string,
        /** Domain identifier (e.g. '1n26A01') */
        domainId: string,
        /** Symmetry instance identifier (e.g. 'ASM-1'), `undefined` for showing all instances */
        instanceId?: string,
    },
    pdbconnect_summary_all_modifications: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
    }
    pdbconnect_summary_modification: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
        /** Modified residue CCD code (e.g. 'MSE') */
        compId: string,
        /** Chain identifier (label_asym_id) */
        labelAsymId: string,
        /** Residue identifier (label_seq_id) */
        labelSeqId: number,
        /** Symmetry instance identifier (e.g. 'ASM-1'), `undefined` for showing all instances */
        instanceId?: string,
    }
}

export type SnapshotKind = keyof SnapshotSpecParams;
export const SnapshotKinds = [
    'entry', 'assembly', 'entity', 'domain', 'ligand', 'modres', 'bfactor', 'validation',
    'pdbconnect_summary_default',
    'pdbconnect_summary_macromolecule',
    'pdbconnect_summary_all_ligands',
    'pdbconnect_summary_ligand',
    'pdbconnect_summary_domains_default',
    'pdbconnect_summary_domains_in_source',
    'pdbconnect_summary_domain',
    'pdbconnect_summary_all_modifications',
    'pdbconnect_summary_modification',
] as const satisfies readonly SnapshotKind[];

export type SnapshotSpec<TKind extends SnapshotKind = SnapshotKind> =
    TKind extends SnapshotKind
    ? { kind: TKind, params: SnapshotSpecParams[TKind], name: string }
    : never; // extends clause needed to create discriminated union type properly

export const ValidationTypes = ['issue_count', 'bond_angles', 'clashes', 'sidechain_outliers', 'symm_clashes', 'planes'] as const;
export type ValidationType = (typeof ValidationTypes)[number];

/** Special value for `assemblyId` meaning that the preferred assembly should be used. */
export const PREFERRED = 'preferred';

/** Special value for `assemblyId` meaning that the deposited model should be used instead of any assembly. */
export const MODEL = 'model';
