import TabContext from '@mui/lab/TabContext';
import TabPanel from '@mui/lab/TabPanel';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import React, { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { BehaviorSubject } from 'rxjs';
import './App.css';
import { getDefaultMVSSnapshotProvider, SnapshotSpec } from './snapshot-provider/mvs-snapshot-provider';


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
    readonly mvsProvider = getDefaultMVSSnapshotProvider();
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
            const snapshot: MVSData = await this.mvsProvider.getSnapshot(snapshotSpec);
            console.log(Molstar.PluginExtensions.mvs.MVSData.toPrettyString(snapshot))
            // await new Promise(resolve => setTimeout(resolve, 500));
            this.snapshot.next(snapshot);
            await Molstar.PluginExtensions.mvs.loadMVS(this.viewer.plugin, snapshot, { replaceExisting: true });
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
    const kinds = model.mvsProvider.listSnapshotKinds();
    const [snapshots, setSnapshots] = useState<SnapshotSpec[]>([]);
    useEffect(() => {
        model.mvsProvider.listSnapshots(entryId).then(setSnapshots);
    }, [model, entryId]);

    const [tab, setTab] = React.useState(kinds[0]);

    return <div className='ControlsWindow'>
        <h1>{entryId}</h1>
        <TabContext value={tab} >
            <Tabs value={tab} onChange={(_, value) => setTab(value)}>
                {kinds.map(kind => <Tab label={kind} value={kind} key={kind} style={{ padding: 2 }} />)}
            </Tabs>
            {kinds.map(kind => <TabPanel value={kind} style={{ paddingBlock: 16, paddingInline: 4 }} key={kind}>
                <ViewButtons model={model} snapshots={snapshots.filter(s => s.kind === tab)} />
            </TabPanel>)}
        </TabContext>
        <Description model={model} />
    </div>;
}

function ViewButtons({ model, snapshots }: { model: AppModel, snapshots: SnapshotSpec[] }) {
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

    return <div className='ViewButtons'>
        {snapshots.map(s =>
            <Button key={s.name} variant={s.name === snapshotName ? 'contained' : 'outlined'} style={{ margin: 2 }}
                disabled={busy} onClick={() => model.loadSnapshot(s)}>
                {s.name}
            </Button>
        )}
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
