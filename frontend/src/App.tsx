import { useState } from 'react';
import './styles/globals.css';
import { useAppStore } from './store/appStore';
import { Topbar }  from './components/layout/Topbar';
import { Sidebar } from './components/layout/Sidebar';
import { ToastContainer } from './components/ui/Toast';
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
  const { currentPage } = useAppStore();
  // Sidebar visible by default, hamburger toggles it
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
      default:                return <PlaceholderPage title="Not Found" icon="❓" />;
    }
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
