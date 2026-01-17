import AccountSettings from './pages/AccountSettings';
import AdminDocuments from './pages/AdminDocuments';
import DebugRoutes from './pages/DebugRoutes';
import FileView from './pages/FileView';
import Home from './pages/Home';
import ProjectFiles from './pages/ProjectFiles';
import ProjectNotes from './pages/ProjectNotes';
import ProjectSchedule from './pages/ProjectSchedule';
import ProjectTalk from './pages/ProjectTalk';
import Projects from './pages/Projects';
import QuickCheck from './pages/QuickCheck';
import ShareView from './pages/ShareView';
import public_ from './pages/_public';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AccountSettings": AccountSettings,
    "AdminDocuments": AdminDocuments,
    "DebugRoutes": DebugRoutes,
    "FileView": FileView,
    "Home": Home,
    "ProjectFiles": ProjectFiles,
    "ProjectNotes": ProjectNotes,
    "ProjectSchedule": ProjectSchedule,
    "ProjectTalk": ProjectTalk,
    "Projects": Projects,
    "QuickCheck": QuickCheck,
    "ShareView": ShareView,
    "_public": public_,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};