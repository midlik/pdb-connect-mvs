import { MenuItem, Select } from '@mui/material';
import Button from '@mui/material/Button';
import React, { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { BehaviorSubject } from 'rxjs';
import './App.css';
import { ApiDataProvider } from './snapshot-provider/data-provider';
import { MolstarModelProvider } from './snapshot-provider/model-provider';
import { DefaultMVSSnapshotProviderConfig, MVSSnapshotProvider, MVSSnapshotProviderConfig, SnapshotSpec } from './snapshot-provider/mvs-snapshot-provider';


type Molstar = typeof import('molstar/lib/apps/viewer');
const Molstar: Molstar = (window as any).molstar;
if (!Molstar) {
    throw new Error('window.molstar not defined, include it with <script type="text/javascript" src="https://molstar.org/viewer/molstar.js"></script>');
}

type Viewer = InstanceType<Molstar['Viewer']>;
type MVSData = ReturnType<Molstar['PluginExtensions']['mvs']['MVSData']['fromMVSJ']>;
// import { type Viewer } from 'molstar/lib/apps/viewer';
// import { type MVSData } from 'molstar/lib/extensions/mvs/mvs-data';


function App() {
    const _model = useRef<AppModel>();
    _model.current ??= new AppModel();
    const model = _model.current;

    const entryId = new URLSearchParams(window.location.search).get('id');
    if (!entryId) window.location.search = 'id=1tqn';

    return (
        <div className="App">
            <ViewerWindow model={model} />
            <ControlsWindow model={model} entryId={entryId ?? '1tqn'} />
        </div>
    );
}

export default App;


class AppModel {
    viewer?: Viewer;
    mvsProvider: MVSSnapshotProvider = getMVSSnapshotProvider({
        // PdbApiUrlPrefix: 'http://localhost:3000/local_data/api',
        // PdbStructureUrlTemplate: 'http://localhost:3000/local_data/structures/{pdb}.bcif',
    });
    readonly snapshotSpec = new BehaviorSubject<SnapshotSpec | undefined>(undefined);
    readonly snapshot = new BehaviorSubject<MVSData | undefined>(undefined);
    readonly isBusy = new BehaviorSubject<boolean>(false);

    async initViewer(target: HTMLElement) {
        const viewer = await Molstar.Viewer.create(target, {
            disabledExtensions: ['volseg'],
            layoutIsExpanded: false,
            viewportShowExpand: true,
            layoutShowSequence: false,
            layoutShowLog: true,
            collapseLeftPanel: true,
            layoutShowControls: false,
        });
        this.viewer = viewer;
        return viewer;
    }

    async loadSnapshot(snapshotSpec: SnapshotSpec) {
        if (!this.viewer) return;
        this.isBusy.next(true);
        try {
            let snapshot: MVSData = await this.mvsProvider.getSnapshot(snapshotSpec, false);
            snapshot = Molstar.PluginExtensions.mvs.MVSData.fromMVSJ(Molstar.PluginExtensions.mvs.MVSData.toMVSJ(snapshot)); // TODO remove this once MVS validation in Molstar handles undefineds correctly
            const mvsj = Molstar.PluginExtensions.mvs.MVSData.toMVSJ(snapshot, 0)
            // console.log('mvsj', mvsj.length, mvsj)
            console.log(Molstar.PluginExtensions.mvs.MVSData.toPrettyString(snapshot))
            // await new Promise(resolve => setTimeout(resolve, 500));
            this.snapshot.next(snapshot);
            console.time('loadMVS')
            await Molstar.PluginExtensions.mvs.loadMVS(this.viewer.plugin, snapshot, {});
            console.timeEnd('loadMVS')
            this.snapshotSpec.next(snapshotSpec);
        } finally {
            this.isBusy.next(false);
        }
    }
}

function ViewerWindow({ model }: { model: AppModel }) {
    const target = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!target.current) return;
        const viewerPromise = model.initViewer(target.current);
        return () => {
            viewerPromise.then(viewer => viewer.dispose());
        };
    }, [model]);
    return <div ref={target} className='ViewerWindow'></div>;
}

function ControlsWindow({ model, entryId }: { model: AppModel, entryId: string }) {
    const [snapshots, setSnapshots] = useState<SnapshotSpec[] | undefined>(undefined);
    useEffect(() => {
        model.mvsProvider.listSnapshots(entryId).then(setSnapshots);
    }, [model, entryId]);

    const kinds = model.mvsProvider.listSnapshotKinds();
    const [category, setCategory] = React.useState<string>('pdbconnect_summary_all_ligands');

    return <div className='ControlsWindow'>
        <h1>{entryId}</h1>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', margin: 6 }}>
            View&nbsp;category:&emsp;
            <Select fullWidth
                labelId="view-category-select-label"
                id="view-category-select"
                value={category}
                label="Age"
                onChange={e => setCategory(e.target.value)}
                style={{ height: '2.5em' }}
            >
                {kinds.map(kind =>
                    <MenuItem value={kind}>{`${kind} (${snapshots?.filter(s => s.kind === kind).length ?? '⏳'})`}</MenuItem>
                )}
            </Select>
        </div>
        <ViewButtons model={model} snapshots={snapshots?.filter(s => s.kind === category)} />
        <hr />
        <Description model={model} />
    </div>;
}

function ViewButtons({ model, snapshots }: { model: AppModel, snapshots: SnapshotSpec[] | undefined }) {
    const [busy, setBusy] = useState<boolean>();
    const [snapshotName, setSnapshotName] = useState<string | undefined>();
    useEffect(() => {
        const sub = model.snapshotSpec.subscribe(s => setSnapshotName(s?.name));
        return () => sub.unsubscribe();
    }, [model]);
    useEffect(() => {
        const sub = model.isBusy.subscribe(setBusy);
        return () => sub.unsubscribe();
    }, [model]);
    const [maxSnapshots, setMaxSnapshots] = useState(0);
    useEffect(() => setMaxSnapshots(200), [snapshots]);

    return <div className='ViewButtons'>
        {snapshots && snapshots.length > maxSnapshots &&
            <div style={{ marginBottom: 8 }}>
                <i>Showing only first {maxSnapshots} views in this category, for UI performance reasons. </i>
                <Button variant='text' onClick={() => setMaxSnapshots(Infinity)}>Show all</Button>
            </div>
        }
        {snapshots?.slice(0, maxSnapshots).map(s =>
            <Button key={s.name} variant={s.name === snapshotName ? 'contained' : 'outlined'} style={{ margin: 2, textTransform: 'none' }}
                disabled={busy} onClick={() => model.loadSnapshot(s)} >
                {s.name}
            </Button>
        )}
        {snapshots === undefined && <i style={{ color: 'gray' }}>Loading views...</i>}
        {snapshots?.length === 0 && <i style={{ color: 'gray' }}>No views in this category.</i>}
    </div>;
}

function Description({ model }: { model: AppModel }) {
    const [snapshot, setSnapshot] = useState<MVSData>();
    useEffect(() => {
        const sub = model.snapshot.subscribe(setSnapshot);
        return () => sub.unsubscribe();
    }, [model]);

    return <div className='Description'>
        {snapshot && <Markdown>{snapshot.metadata.description}</Markdown>}
        {!snapshot && <i style={{ color: 'gray' }}>No view selected.</i>}
    </div>;
}


/** Return a new MVSSnapshotProvider taking data from PDBe API (https://www.ebi.ac.uk/pdbe/api/v2) */
function getMVSSnapshotProvider(config?: Partial<MVSSnapshotProviderConfig>): MVSSnapshotProvider {
    const fullConfig: MVSSnapshotProviderConfig = { ...DefaultMVSSnapshotProviderConfig, ...config };
    const dataProvider = new ApiDataProvider(fullConfig.PdbApiUrlPrefix);
    const modelProvider = new MolstarModelProvider();
    return new MVSSnapshotProvider(dataProvider, modelProvider, fullConfig);
}
