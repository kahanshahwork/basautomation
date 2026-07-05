import { useState, useEffect } from 'react';
import './styles/globals.css';
import { useAppStore } from './store/appStore';
import { authApi, setUnauthorizedHandler } from './api/client';
import { Topbar }  from './components/layout/Topbar';
import { Sidebar } from './components/layout/Sidebar';
import { ToastContainer } from './components/ui/Toast';
import { LoginPage }             from './pages/Login';
import { AdminPage }             from './pages/Admin';
import { ClientManagementPage } from './pages/ClientManagement';
import { UploadParsePage }      from './pages/UploadParse';
import { ApprovePage }          from './pages/Approve';
import { CategorizePage }       from './pages/Categorize';
import { GstPage }              from './pages/Gst';
import { PnlPage }              from './pages/Pnl';
import { ConsolidatePage }      from './pages/Consolidate';
import { AiVisionPage }          from './pages/AiVision';
import { AiCategorizePage }      from './pages/AiCategorize';
import { VendorMemoryPage }     from './pages/VendorMemory';
import { CategoryManagerPage }  from './pages/CategoryManager';
import { PlaceholderPage }      from './pages/Placeholder';

export default function App() {
  const { currentPage, authUser, authChecked, setAuthUser, setAuthChecked, setPage } = useAppStore();
  // Sidebar visible by default, hamburger toggles it
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // On load, check for an existing session. Also register the global 401 handler
  // so any expired/invalid session immediately drops the app back to login.
  useEffect(() => {
    setUnauthorizedHandler(() => { setAuthUser(null); });
    authApi.me()
      .then(r => setAuthUser(r.user))
      .catch(() => setAuthUser(null))
      .finally(() => setAuthChecked(true));
  }, [setAuthUser, setAuthChecked]);

  // Guard: if a non-admin is somehow on the admin page, bounce them out.
  useEffect(() => {
    if (currentPage === 'admin' && authUser && authUser.role !== 'admin') {
      setPage('clients');
    }
  }, [currentPage, authUser, setPage]);

  function renderPage() {
    switch (currentPage) {
      case 'clients':         return <ClientManagementPage />;
      case 'parse':           return <UploadParsePage />;
      case 'approve':         return <ApprovePage />;
      case 'categorize':      return <CategorizePage />;
      case 'gst':             return <GstPage />;
      case 'pnl':             return <PnlPage />;
      case 'consolidate':     return <ConsolidatePage />;
      case 'vendormemory':    return <VendorMemoryPage />;
      case 'categorymanager': return <CategoryManagerPage />;
      case 'aicategorize':    return <AiCategorizePage />;
      case 'aivision':        return <AiVisionPage />;
      case 'admin':           return <AdminPage />;
      default:                return <PlaceholderPage title="Not Found" icon="❓" />;
    }
  }

  // While the initial session check runs, show nothing (avoids a login flash).
  if (!authChecked) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>;
  }

  // Not logged in → the ONLY thing that renders is the login screen. No app
  // shell, no data pages — so there is nothing to bypass via URL or state.
  if (!authUser) {
    return (
      <>
        <LoginPage />
        <ToastContainer />
      </>
    );
  }

  return (
    <div className="app-shell">
      <Topbar onMenuClick={() => setSidebarOpen(o => !o)} />
      <div className="app-body">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="page-content" style={{ marginLeft: sidebarOpen ? 256 : 0, transition: 'margin-left .24s cubic-bezier(.4,0,.2,1)' }}>
          {renderPage()}
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
