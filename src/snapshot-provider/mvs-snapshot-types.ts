export type SnapshotSpecParams = {
    entry: { entry: string },
    assembly: { entry: string, assemblyId: string },
    entity: { entry: string, entityId: string, assemblyId?: string },
    domain: { entry: string, source: string, familyId: string, entityId: string }, // source / family / entity / chain / instance
    ligand: { entry: string, compId: string, labelAsymId?: string },
    modres: { entry: string, compId: string },
    bfactor: { entry: string },
    validation: { entry: string, validation_type: ValidationType },
    /** PDBconnect Summary tab > Preferred complex (default view), Complexes tab */
    pdbconnect_complex: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly) */
        assemblyId: string,
    },
    /** PDBconnect Summary tab > Macromolecules (macromolecule selected), Macromolecules tab */
    pdbconnect_macromolecule: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
        /** Entity ID of the macromolecule (polymer or branched) entity */
        entityId: string,
        /** Chain identifier (label_asym_id) */
        labelAsymId: string,
        /** Symmetry instance identifier (e.g. 'ASM-1'), `undefined` for showing all instances */
        instanceId: string | undefined,
    },
    /** PDBconnect Summary tab > Ligands (nothing selected) */
    pdbconnect_all_ligands: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
    },
    /** PDBconnect Summary tab > Ligands (ligand selected) */
    pdbconnect_ligand: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
        /** Entity ID of the ligand entity */
        entityId: string,
        /** Chain identifier (label_asym_id) */
        labelAsymId: string,
        /** Symmetry instance identifier (e.g. 'ASM-1'), `undefined` for showing all instances */
        instanceId: string | undefined,
    },
    /** PDBconnect Summary tab > Domains > All (nothing selected) */
    pdbconnect_domains_default: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
    },
    /** PDBconnect Summary tab > Domains > CATH/Pfam/SCOP (nothing selected) */
    pdbconnect_domains_in_source: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
        /** Source database (CATH | SCOP | Pfam) */
        source: string,
    },
    /** PDBconnect Summary tab > Domains (domain selected), Domains tab */
    pdbconnect_domain: {
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
        instanceId: string | undefined,
    },
    /** PDBconnect Summary tab > Modifications (nothing selected) */
    pdbconnect_all_modifications: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
    }
    /** PDBconnect Summary tab > Modifications (modification selected) */
    pdbconnect_modification: {
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
        instanceId: string | undefined,
    },
    /** PDBconnect Model Quality tab */
    pdbconnect_quality: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
        /** Validation view type (either 'issue_count' for number of outlier types on a residue, or name of a specific outlier type) */
        validation_type: ValidationType,
    },
    /** PDBconnect Ligands and Environments tab */
    pdbconnect_environment: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
        /** Chain identifier (label_asym_id) */
        labelAsymId: string,
        /** Author chain identifier (auth_asym_id) */
        authAsymId: string,
        /** Author residue number (auth_seq_id) */
        authSeqId: number,
        /** Residue insertion code (pdbx_PDB_ins_code) */
        authInsCode: string,
        /** Symmetry instance identifier (e.g. 'ASM-1'), `undefined` for showing all instances */
        instanceId: string | undefined,
        /** Source of atom interactions to be shown */
        atomInteractions: 'api' | 'builtin' | 'none',
    },
    /** PDBconnect Text Annotations tab (residue selected) */
    pdbconnect_text_annotation: {
        /** PDB ID */
        entry: string,
        /** Assembly ID (or 'preferred' for preferred assembly, or 'model' for deposited model) */
        assemblyId: string,
        /** Entity identifier (label_entity_id) */
        entityId: string,
        /** Chain identifier (label_asym_id) */
        labelAsymId: string,
        /** Residue number (label_seq_id) for highlighted residue, `undefined` for showing the whole chain */
        labelSeqId: number | undefined,
        /** Symmetry instance identifier (e.g. 'ASM-1'), `undefined` for showing all instances */
        instanceId: string | undefined,
    },
}

export type SnapshotKind = keyof SnapshotSpecParams;
export const SnapshotKinds = [
    'entry', 'assembly', 'entity', 'domain', 'ligand', 'modres', 'bfactor', 'validation',
    'pdbconnect_complex',
    'pdbconnect_macromolecule',
    'pdbconnect_all_ligands',
    'pdbconnect_ligand',
    'pdbconnect_domains_default',
    'pdbconnect_domains_in_source',
    'pdbconnect_domain',
    'pdbconnect_all_modifications',
    'pdbconnect_modification',
    'pdbconnect_quality',
    'pdbconnect_environment',
    'pdbconnect_text_annotation',
] as const satisfies readonly SnapshotKind[];

export type SnapshotSpec<TKind extends SnapshotKind = SnapshotKind> =
    TKind extends SnapshotKind
    ? { kind: TKind, params: SnapshotSpecParams[TKind], name: string }
    : never; // extends clause needed to create discriminated union type properly

/** Validation view type ('issue_count' for number of outlier types, or specific outlier type (this list might not be complete)) */
export const ValidationTypes = ['issue_count', 'bond_angles', 'clashes', 'sidechain_outliers', 'symm_clashes', 'planes', 'RSRZ'] as const;
export type ValidationType = (typeof ValidationTypes)[number];

/** Special value for `assemblyId` meaning that the preferred assembly should be used. */
export const PREFERRED = 'preferred';

/** Special value for `assemblyId` meaning that the deposited model should be used instead of any assembly. */
export const MODEL = 'model';
