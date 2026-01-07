import AccountSettings from './pages/AccountSettings';
import DebugRoutes from './pages/DebugRoutes';
import FileView from './pages/FileView';
import Home from './pages/Home';
import ProjectFiles from './pages/ProjectFiles';
import ProjectNotes from './pages/ProjectNotes';
import ProjectSchedule from './pages/ProjectSchedule';
import ProjectTalk from './pages/ProjectTalk';
import Projects from './pages/Projects';
import ShareView from './pages/ShareView';
import public_ from './pages/_public';
import QuickCheck from './pages/QuickCheck';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AccountSettings": AccountSettings,
    "DebugRoutes": DebugRoutes,
    "FileView": FileView,
    "Home": Home,
    "ProjectFiles": ProjectFiles,
    "ProjectNotes": ProjectNotes,
    "ProjectSchedule": ProjectSchedule,
    "ProjectTalk": ProjectTalk,
    "Projects": Projects,
    "ShareView": ShareView,
    "_public": public_,
    "QuickCheck": QuickCheck,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};