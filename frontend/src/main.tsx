import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { WorkspaceProvider } from "./store/workspace";
import "./vendor/jsmind.css";
import "./index.css";

// 注意：不使用 StrictMode——jsMind 是命令式第三方库，StrictMode 的
// 双挂载会泄漏容器事件监听（jsMind 无 dispose 方法）。
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>
  </BrowserRouter>,
);
