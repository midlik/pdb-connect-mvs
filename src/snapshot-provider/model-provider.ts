import { CIF } from 'molstar/lib/mol-io/reader/cif';
import { trajectoryFromMmCIF } from 'molstar/lib/mol-model-formats/structure/mmcif';
import { type Model } from 'molstar/lib/mol-model/structure';
import { Task } from 'molstar/lib/mol-task';


export interface IModelProvider {
    getModel(entryId: string): Promise<Model>,
}


export class MolstarModelProvider implements IModelProvider {
    async getModel(entryId: string): Promise<Model> {
        const url = `https://www.ebi.ac.uk/pdbe/entry-files/${entryId}.bcif`
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch model for ${entryId}: status code ${response.status}, URL ${url}`);
        }
        const buffer = await response.arrayBuffer();
        const data = new Uint8Array(buffer);
        const parsed = await CIF.parseBinary(data).run();
        if (parsed.isError) {
            throw new Error(`Failed to parse model for ${entryId}: line ${parsed.line}: ${parsed.message}`);
        }
        const file = parsed.result;
        const trajectory = await trajectoryFromMmCIF(file.blocks[0]).run();
        const model = await Task.resolveInContext(trajectory.getFrameAtIndex(0));
        return model;
    }
}
