import { NavLink, Route, Routes } from "react-router-dom";
import InstancesPage from "./pages/InstancesPage";
import QueryPage from "./pages/QueryPage";
import RequestsPage from "./pages/RequestsPage";
import StubsPage from "./pages/StubsPage";
import ScenariosPage from "./pages/ScenariosPage";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">WM</span>
          <div>
            <strong>WireMock Collector</strong>
            <div className="muted small">Request journal archive</div>
          </div>
        </div>
        <nav>
          <NavLink to="/" end>
            Requests
          </NavLink>
          <NavLink to="/stubs">Stubs</NavLink>
          <NavLink to="/scenarios">Scenarios</NavLink>
          <NavLink to="/query">Query</NavLink>
          <NavLink to="/instances">Instances</NavLink>
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<RequestsPage />} />
          <Route path="/stubs" element={<StubsPage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="/query" element={<QueryPage />} />
          <Route path="/instances" element={<InstancesPage />} />
        </Routes>
      </main>
    </div>
  );
}
