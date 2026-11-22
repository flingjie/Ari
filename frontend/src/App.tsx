import { useEffect } from "react";
import { useProactiveTrigger } from "./lib/useProactiveTrigger";
import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import { STAGES, STAGE_NAMES, type Stage } from "./lib/types";
import { STAGE_HINTS, STAGE_TITLES } from "./lib/stageMeta";
import { useWorkspace } from "./store/workspace";
import { ChatProvider, useChat } from "./store/chat";
import { SaveStatus } from "./components/SaveStatus";
import { ChatPanel } from "./components/ChatPanel";
import { LandingPage } from "./routes/LandingPage";
import PurposePage from "./routes/PurposePage";
import PiecePage from "./routes/PiecePage";
import PerspectivePage from "./routes/PerspectivePage";
import PillarPage from "./routes/PillarPage";
import PresentationPage from "./routes/PresentationPage";

const PAGES: Record<Stage, () => JSX.Element | null> = {
  purpose: PurposePage,
  piece: PiecePage,
  perspective: PerspectivePage,
  pillar: PillarPage,
  presentation: PresentationPage,
};

function ChatToggle() {
  const { panelOpen, setPanelOpen } = useChat();
  return (
    <button
      type="button"
      aria-pressed={panelOpen}
      onClick={() => setPanelOpen(!panelOpen)}
    >
      对话
    </button>
  );
}

function ProactiveTrigger({ workspaceId, stage }: { workspaceId: string; stage: Stage }) {
  useProactiveTrigger({ workspaceId, stage });
  return null;
}

function WorkspaceShell() {
  const { id, stage } = useParams<{ id: string; stage: Stage }>();
  const ws = useWorkspace();

  useEffect(() => {
    if (id) {
      void ws.load(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id) {
    return <Navigate to="/" replace />;
  }

  if (!stage || !(stage in PAGES)) {
    return <Navigate to={`/w/${id}/purpose`} replace />;
  }

  if (ws.loadState === "loading" || !ws.snapshot) {
    return (
      <div className="app">
        <p>加载中…</p>
      </div>
    );
  }
  if (ws.loadState === "error") {
    return (
      <div className="app">
        <p>工作区加载失败。</p>
        <p>
          <Link to="/">返回新建</Link>
        </p>
      </div>
    );
  }

  const stageIndex = STAGES.indexOf(stage);
  const Page = PAGES[stage];

  return (
    <ChatProvider workspaceId={id} stage={stage}>
      <ProactiveTrigger workspaceId={id} stage={stage} />
      <div className="workspace">
        <main className="workspace-main">
          <header>
            <b>阿理 / Ari</b>
            <div className="actions">
              <SaveStatus />
              <ChatToggle />
            </div>
          </header>

          <nav className="stage-nav" aria-label="阶段导航">
            {STAGES.map((s) => (
              <Link
                key={s}
                to={`/w/${id}/${s}`}
                aria-current={s === stage ? "page" : undefined}
              >
                {STAGE_NAMES[s]}
              </Link>
            ))}
          </nav>

          <small>
            {stageIndex + 1} / 5　{STAGES[stageIndex]}
          </small>
          <h1>{STAGE_TITLES[stage]}</h1>
          <p>{STAGE_HINTS[stage]}</p>

          <section>
            <Page key={id} />
          </section>

          <footer>
            {stageIndex > 0 ? (
              <Link to={`/w/${id}/${STAGES[stageIndex - 1]}`}>← 上一步</Link>
            ) : (
              <span />
            )}
            {stageIndex < STAGES.length - 1 ? (
              <Link className="btn primary" to={`/w/${id}/${STAGES[stageIndex + 1]}`}>
                下一步 · {STAGE_NAMES[STAGES[stageIndex + 1]]} →
              </Link>
            ) : (
              <span />
            )}
          </footer>
        </main>

        <ChatPanel stage={stage} />
      </div>
    </ChatProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/w/:id" element={<Navigate to="purpose" replace />} />
      <Route path="/w/:id/:stage" element={<WorkspaceShell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
